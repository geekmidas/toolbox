/**
 * Mail and object storage on a deployed stage: real ones, or — only when
 * someone asked — the dev services the local stage runs.
 *
 * Locally a declared `Email` is Mailpit and a declared bucket is MinIO, and
 * nobody has to configure either. Deployed, the same two containers would be
 * a stage that silently delivers no mail and keeps its files on one
 * container's disk. So a deployed stage on a server target takes both from
 * its secrets — the mail server's URL and sending address, each bucket's URL
 * and the key pair the S3 client signs with — and a stage missing any of them
 * fails before anything is built, provisioned or written, naming every key at
 * once.
 *
 * `--allow-dev-services minio,mailpit` is the way out for a stage that is
 * not production — a preview, a demo: the target runs the dev service and
 * derives the keys from it. Keys the stage did set still win. Every run that
 * uses one says so, loudly.
 *
 * Pure: what each target runs is decided here from declarations and the
 * stage's values, and the targets do the running.
 */

import {
	type ConstructManifest,
	dependentsOf,
	provideKey,
} from '@geekmidas/manifest';
import { appKey } from '../workspace/derive.js';

/** The dev services a deployed stage may be allowed to run. */
export const DEV_SERVICES = ['minio', 'mailpit'] as const;

export type DevService = (typeof DEV_SERVICES)[number];

/** The S3 client's key pair, which a bucket on a server target signs with. */
export const STORAGE_KEY_PAIR = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
] as const;

/** A `--allow-dev-services` value that is not a dev service. */
export class UnknownDevService extends Error {
	constructor(readonly value: string) {
		super(
			`'${value}' is not a dev service. --allow-dev-services takes a ` +
				`comma-separated list of ${DEV_SERVICES.join(', ')}: ` +
				`--allow-dev-services ${DEV_SERVICES.join(',')}`,
		);
		this.name = 'UnknownDevService';
	}
}

/** Dev services asked of a target that runs no containers. */
export class DevServicesNeedServerTarget extends Error {
	constructor(
		readonly target: string,
		readonly services: readonly DevService[],
	) {
		super(
			`--allow-dev-services applies to server targets only, and '${target}' ` +
				`deploys to AWS, where a bucket is S3 and mail is the stage's own. ` +
				`Drop --allow-dev-services ${services.join(',')}.`,
		);
		this.name = 'DevServicesNeedServerTarget';
	}
}

/** One key a deployed stage needs and its secrets do not hold. */
export interface MissingServiceKey {
	key: string;
	/** The construct that reads it, or the buckets for the S3 key pair. */
	id: string;
	/** What it is, for the line that names it. */
	what: string;
	/** A placeholder value to show in the `gkm secrets:set` line. */
	example: string;
	/** The dev service that would stand in for it. */
	service: DevService;
	/** The apps that read it, where known. */
	apps?: readonly string[];
}

/**
 * A deployed stage with mail or object storage that its secrets do not
 * configure — every missing key, across every app, at once.
 */
export class ExternalServicesNotConfigured extends Error {
	constructor(
		readonly stage: string,
		readonly missing: readonly MissingServiceKey[],
	) {
		const services = [...new Set(missing.map((m) => m.service))].sort();
		const lines = missing.map((m) => {
			const by = m.apps?.length ? `, read by ${m.apps.join(', ')}` : '';
			return (
				`  gkm secrets:set ${m.key} '${m.example}' --stage ${stage}\n` +
				`      ${m.what}${by}`
			);
		});
		super(
			`The stage '${stage}' is deployed, and a deployed stage's mail and ` +
				`object storage are real services: gkm runs no Mailpit or MinIO for ` +
				`it. Set ${missing.length === 1 ? 'this key' : `these ${missing.length} keys`} in the stage's secrets:\n\n` +
				`${lines.join('\n')}\n\n` +
				`For a stage that is not production — a preview, a demo — the dev ` +
				`services can run instead, with --allow-dev-services ` +
				`${services.join(',')}. Mailpit delivers no mail, and MinIO keeps ` +
				`every object on one container's disk.`,
		);
		this.name = 'ExternalServicesNotConfigured';
	}
}

/**
 * The dev services a value names: `'minio,mailpit'`, or a list of them.
 *
 * @throws {UnknownDevService} for anything that is not one
 */
export function parseDevServices(
	value: string | readonly string[] | undefined,
): DevService[] {
	if (value === undefined) return [];
	const items = (typeof value === 'string' ? [value] : value)
		.flatMap((item) => item.split(','))
		.map((item) => item.trim())
		.filter(Boolean);

	const services = new Set<DevService>();
	for (const item of items) {
		if (!(DEV_SERVICES as readonly string[]).includes(item)) {
			throw new UnknownDevService(item);
		}
		services.add(item as DevService);
	}
	return [...services].sort();
}

/** A declaration that is mail or object storage. */
export interface ServiceDeclaration {
	id: string;
	kind: 'email' | 'objects' | 'file-server';
	/** A file server's bucket. */
	of?: string;
	/** The apps that read it, where known. */
	apps?: readonly string[];
}

/**
 * Every mail and storage construct a manifest declares, with the apps that
 * depend on each — what a target that provisions the whole manifest checks.
 */
export function manifestServiceDeclarations(
	manifest: ConstructManifest,
): ServiceDeclaration[] {
	return Object.entries(manifest).flatMap(
		([id, declaration]): ServiceDeclaration[] => {
			const { kind } = declaration;
			if (kind !== 'email' && kind !== 'objects' && kind !== 'file-server') {
				return [];
			}
			const apps = dependentsOf(manifest, id)
				.filter((caller) => {
					const callerKind = manifest[caller]?.kind;
					return callerKind === 'rest-api' || callerKind === 'site';
				})
				.map(appKey);
			return [
				{
					id,
					kind,
					...(declaration.kind === 'file-server' ? { of: declaration.of } : {}),
					...(apps.length ? { apps } : {}),
				},
			];
		},
	);
}

export interface ExternalServicesInput {
	stage: string;
	/** Every mail and storage construct something on the stage reads. */
	declarations: readonly ServiceDeclaration[];
	/** The stage's values by key — what `gkm secrets:set` stored. */
	supplied: Readonly<Record<string, string>>;
	/** What `--allow-dev-services` allowed. */
	allow: readonly DevService[];
	/** The stage's base domain, for the examples. */
	domain?: string;
}

/** Where a deployed stage's mail and storage come from. */
export interface ExternalServices {
	/** Keys the stage needs and has not set. Empty when it can deploy. */
	missing: MissingServiceKey[];
	/** The buckets the target runs MinIO for. */
	minio: string[];
	/** The mail constructs the target runs Mailpit for. */
	mailpit: string[];
}

/** One dev service a run uses, and for which constructs. */
export interface DevServiceUse {
	service: DevService;
	ids: string[];
}

/**
 * Where a deployed stage's mail and storage come from, and what it lacks.
 *
 * - Mail is external once its URL is set, and then needs its sending
 *   address too. Unset, it is Mailpit where allowed — the address derived
 *   unless set — and missing otherwise.
 * - A bucket is external once its URL is set, and then needs the S3 key
 *   pair. Unset, it is MinIO where allowed, and missing otherwise.
 * - A file server's URL is derived where its bucket is MinIO, unless set;
 *   over an external bucket the stage must set it.
 */
export function externalServices(
	input: ExternalServicesInput,
): ExternalServices {
	const { supplied, allow } = input;
	const has = (key: string) => supplied[key] !== undefined;
	const domain = input.domain ?? 'example.com';

	const missing: MissingServiceKey[] = [];
	const minio: string[] = [];
	const mailpit: string[] = [];
	const add = (entry: MissingServiceKey) => {
		if (!missing.some((m) => m.key === entry.key)) missing.push(entry);
	};

	const declarations = [...input.declarations].sort((a, b) =>
		a.id.localeCompare(b.id),
	);
	const apps = (d: ServiceDeclaration) =>
		d.apps?.length ? { apps: [...d.apps].sort() } : {};

	for (const d of declarations.filter((d) => d.kind === 'email')) {
		const url = provideKey(d.id, 'url');
		const from = provideKey(d.id, 'from');
		if (!has(url) && allow.includes('mailpit')) {
			mailpit.push(d.id);
			continue;
		}
		if (!has(url)) {
			add({
				key: url,
				id: d.id,
				what: `where '${d.id}' sends mail — any SMTP server`,
				example: `smtp://user:password@smtp.${domain}:587`,
				service: 'mailpit',
				...apps(d),
			});
		}
		if (!has(from)) {
			add({
				key: from,
				id: d.id,
				what: `the address '${d.id}' sends from, on a domain the mail server has verified`,
				example: `noreply@${domain}`,
				service: 'mailpit',
				...apps(d),
			});
		}
	}

	const external: ServiceDeclaration[] = [];
	for (const d of declarations.filter((d) => d.kind === 'objects')) {
		const url = provideKey(d.id, 'url');
		if (has(url)) {
			external.push(d);
			continue;
		}
		if (allow.includes('minio')) {
			minio.push(d.id);
			continue;
		}
		external.push(d);
		add({
			key: url,
			id: d.id,
			what: `the bucket '${d.id}' — S3, R2, or any S3-compatible store (add &endpoint=… for one that is not S3)`,
			example: `s3://${appKey(d.id)}?region=eu-west-1`,
			service: 'minio',
			...apps(d),
		});
	}

	// One key pair, whichever bucket needs it: the S3 client reads them from
	// the environment, beside every bucket's URL.
	if (external.length > 0) {
		const ids = external.map((d) => d.id);
		const readers = [...new Set(external.flatMap((d) => d.apps ?? []))];
		const pair: Record<(typeof STORAGE_KEY_PAIR)[number], [string, string]> = {
			AWS_ACCESS_KEY_ID: ['the key id the S3 client signs with', 'AKIA…'],
			AWS_SECRET_ACCESS_KEY: ['the secret the S3 client signs with', '…'],
		};
		for (const key of STORAGE_KEY_PAIR) {
			if (has(key)) continue;
			const [what, example] = pair[key];
			add({
				key,
				id: ids.join(', '),
				what: `${what}, for ${ids.join(', ')}`,
				example,
				service: 'minio',
				...(readers.length ? { apps: readers.sort() } : {}),
			});
		}
	}

	for (const d of declarations.filter((d) => d.kind === 'file-server')) {
		const url = provideKey(d.id, 'url');
		if (has(url)) continue;
		if (d.of && minio.includes(d.of)) continue;
		add({
			key: url,
			id: d.id,
			what: `the public address '${d.id}' serves its bucket on — a CDN or the bucket's own domain`,
			example: `https://${appKey(d.id)}.${domain}`,
			service: 'minio',
			...apps(d),
		});
	}

	return { missing, minio, mailpit };
}

/**
 * `externalServices`, refusing a stage that lacks anything.
 *
 * @throws {ExternalServicesNotConfigured} naming every missing key
 */
export function assertExternalServices(
	input: ExternalServicesInput,
): ExternalServices {
	const services = externalServices(input);
	if (services.missing.length > 0) {
		throw new ExternalServicesNotConfigured(input.stage, services.missing);
	}
	return services;
}

/** The dev services a run uses, one entry per service it runs. */
export function devServicesUsed(services: ExternalServices): DevServiceUse[] {
	const used: DevServiceUse[] = [];
	if (services.mailpit.length > 0) {
		used.push({ service: 'mailpit', ids: services.mailpit });
	}
	if (services.minio.length > 0) {
		used.push({ service: 'minio', ids: services.minio });
	}
	return used;
}

/** The line a run prints for each dev service a deployed stage uses. */
export function devServiceWarning(stage: string, use: DevServiceUse): string {
	const what =
		use.service === 'mailpit'
			? `Mailpit is catching mail for ${use.ids.join(', ')}. It delivers NO mail: nobody receives a sign-in link, a receipt or a reset`
			: `MinIO is storing ${use.ids.join(', ')}. Every object is on one container's disk, with no replication and no backup`;
	return (
		`⚠️  DEV SERVICE ON A DEPLOYED STAGE (${stage}): ${what}. It is not ` +
		`production-grade — set the stage's own keys in its secrets for that.`
	);
}

/**
 * Report each dev service a run uses: a loud line, and a `dev-service.used`
 * event a host can act on.
 */
export function reportDevServices(
	ctx: {
		stage: string;
		logger: { warn(message: string): void };
		emit(event: {
			type: 'dev-service.used';
			service: DevService;
			stage: string;
			constructs: string[];
		}): void;
	},
	uses: readonly DevServiceUse[],
): void {
	for (const use of uses) {
		ctx.logger.warn(`\n${devServiceWarning(ctx.stage, use)}`);
		ctx.emit({
			type: 'dev-service.used',
			service: use.service,
			stage: ctx.stage,
			constructs: use.ids,
		});
	}
}
