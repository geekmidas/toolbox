/**
 * Mail and object storage on a deployed stage: real ones, or — only when
 * someone asked — the dev services the local stage runs.
 *
 * Locally a declared `Email` is Mailpit and a declared bucket is MinIO, and
 * nobody has to configure either. Deployed, the same two containers would be
 * a stage that silently delivers no mail and keeps its files on one
 * container's disk. So a deployed stage on a server target takes both from
 * its secrets — the mail server's URL and sending address, and each bucket's
 * URL — and a stage missing any of them fails before anything is built,
 * provisioned or written, naming every key at once.
 *
 * A bucket's credentials are not checked: they are optional, and come from
 * either of two places. The bucket's URL may carry a key of its own
 * (`s3://KEY:SECRET@uploads`), which wins; otherwise the S3 client's default
 * chain applies — the stage's shared `AWS_ACCESS_KEY_ID`/
 * `AWS_SECRET_ACCESS_KEY` when it set them, or a role.
 *
 * `--allow-dev-services` is the way out for a stage that is not production —
 * a preview, a demo: every construct the stage does not account for gets the
 * dev service the local stage runs for it — a bucket MinIO, mail Mailpit —
 * and the target derives the keys from it. What the stage does account for
 * still wins: a key set in its secrets, or a provider (`deploy.objects`)
 * that backs the kind. Every run that uses one says so, loudly.
 *
 * Pure: what each target runs is decided here from declarations and the
 * stage's values, and the targets do the running.
 */

import {
	type ConstructManifest,
	dependentsOf,
	provideKey,
} from '@geekmidas/manifest';
import { SERVER_IPV4_KEY, SERVER_IPV6_KEY } from '../compose/dnsConfig.js';
import { GkmError } from '../errors';
import { appKey } from '../workspace/derive.js';

/**
 * The dev services a deployed stage can run — one per kind that has one on
 * every server target: a bucket's MinIO and mail's Mailpit. A cache or a
 * database is not here because a server stage runs its own anyway.
 */
export const DEV_SERVICES = ['minio', 'mailpit'] as const;

export type DevService = (typeof DEV_SERVICES)[number];

/**
 * The S3 client's shared key pair. Optional: a bucket whose URL carries its own
 * key (`s3://KEY:SECRET@bucket`) signs with that, and one without signs with
 * this pair when the stage set it, or with whatever else the SDK's default
 * chain finds — a role.
 */
export const STORAGE_KEY_PAIR = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
] as const;

/** Dev services asked of a target that runs no containers. */
export class DevServicesNeedServerTarget extends GkmError {
	constructor(readonly target: string) {
		super(
			`--allow-dev-services applies to server targets only, and '${target}' ` +
				`deploys to AWS, where a bucket is S3 and mail is the stage's own. ` +
				'Drop --allow-dev-services.',
		);
		this.name = 'DevServicesNeedServerTarget';
	}
}

/**
 * `--allow-dev-services` given a value — the list it used to take. It is a
 * switch now: every construct the stage does not account for gets its dev
 * service.
 */
export class AllowDevServicesTakesNoValue extends GkmError {
	constructor(readonly value: string) {
		super(
			`--allow-dev-services takes no value (it was given '${value}'). It runs ` +
				'the dev service for every bucket and mail the stage does not account ' +
				'for — no key in its secrets, no provider in deploy.<kind>.<stage> — so ' +
				'there is nothing to list. Pass --allow-dev-services on its own.',
		);
		this.name = 'AllowDevServicesTakesNoValue';
	}
}

/**
 * Refuses `--allow-dev-services <value>` and `--allow-dev-services=<value>` on
 * a command line, with the reason, before the parser calls the value an
 * excess argument. `gkm deploy` and `gkm compose` take no positional
 * argument, so whatever follows the flag and is not a flag was meant for it.
 *
 * @throws {AllowDevServicesTakesNoValue}
 */
export function assertDevServicesFlag(argv: readonly string[]): void {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg.startsWith('--allow-dev-services=')) {
			throw new AllowDevServicesTakesNoValue(arg.slice(arg.indexOf('=') + 1));
		}
		const next = argv[i + 1];
		if (arg === '--allow-dev-services' && next && !next.startsWith('-')) {
			throw new AllowDevServicesTakesNoValue(next);
		}
	}
}

/** One key a deployed stage needs and its secrets do not hold. */
export interface MissingServiceKey {
	key: string;
	/** The construct that reads it. */
	id: string;
	/** What it is, for the line that names it. */
	what: string;
	/** A line after `what`, for what else there is to know about it. */
	note?: string;
	/** A placeholder value to show in the `gkm secrets:set` line. */
	example: string;
	/** The dev service that would stand in for it, unless the stage accounts for it. */
	service?: DevService;
	/** The apps that read it, where known. */
	apps?: readonly string[];
	/** What creates it, where a provider backs it on the stage. */
	hint?: string;
}

/**
 * A deployed stage with mail or object storage that its secrets do not
 * configure — every missing key, across every app, at once.
 */
export class ExternalServicesNotConfigured extends GkmError {
	constructor(
		readonly stage: string,
		readonly missing: readonly MissingServiceKey[],
	) {
		const standIns = missing.some((m) => m.service !== undefined);
		const lines = missing.map((m) => {
			const by = m.apps?.length ? `, read by ${m.apps.join(', ')}` : '';
			return (
				`  gkm secrets:set ${m.key} '${m.example}' --stage ${stage}\n` +
				`      ${m.what}${by}` +
				(m.note ? `\n      ${m.note}` : '') +
				(m.hint ? `\n      ${m.hint}` : '')
			);
		});
		super(
			`The stage '${stage}' is deployed, and a deployed stage's mail and ` +
				`object storage are real services: gkm runs no Mailpit or MinIO for ` +
				`it. Set ${missing.length === 1 ? 'this key' : `these ${missing.length} keys`} in the stage's secrets:\n\n` +
				`${lines.join('\n')}\n\n` +
				(standIns
					? `For a stage that is not production — a preview, a demo — the ` +
						`dev services can run instead, with --allow-dev-services. ` +
						`Mailpit delivers no mail, and MinIO keeps every object on one ` +
						`container's disk.\n\n`
					: '') +
				`Or run: gkm secrets:add --stage ${stage}`,
		);
		this.name = 'ExternalServicesNotConfigured';
	}
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
	/**
	 * `--allow-dev-services`: every construct the stage does not account for
	 * gets its dev service.
	 */
	allow: boolean;
	/** The stage's base domain, for the examples. */
	domain?: string;
	/**
	 * What the stage's providers say, by kind: a kind one backs is accounted
	 * for, so no dev service stands in for it, and a missing key of it names
	 * what creates it.
	 */
	providers?: StageProviderNotes;
}

/** The stage's providers, as a deploy's checks read them. */
export interface StageProviderNotes {
	objects?: {
		/** A provider (or `false`) backs the kind: no dev service for it. */
		accounted: boolean;
		/** What creates a missing key of it. */
		hint?: string;
	};
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

/** A third party's credentials a construct reads: an external API's, or a `Credential`. */
export interface CredentialDeclaration {
	id: string;
	kind: 'external-api' | 'credential';
	/** The apps that read it, where known. */
	apps?: readonly string[];
}

/** What a stage-supplied key belongs to. */
export type StageKeyKind =
	| 'bucket'
	| 'email'
	| 'file-server'
	| 'external-api'
	| 'credential'
	/** The server a compose stage's stack runs on: `GKM_SERVER_IPV4`. */
	| 'server';

/**
 * One key only the stage's secrets can hold — nothing derives it — whether
 * or not it is set.
 */
export interface StageKey {
	key: string;
	/** The construct that reads it. */
	id: string;
	kind: StageKeyKind;
	/** What it is, for the line that names it. */
	what: string;
	/** A line after `what`, for what else there is to know about it. */
	note?: string;
	/** A placeholder value to show in the `gkm secrets:set` line. */
	example: string;
	/** The dev service that would stand in for it, where one can. */
	service?: DevService;
	/** What creates it, where a provider backs it on the stage. */
	hint?: string;
	/** A file server's bucket. */
	of?: string;
	/** The apps that read it, where known. */
	apps?: readonly string[];
}

export interface StageKeysInput {
	/** Whether the stage is the local one, which derives its mail and storage. */
	local: boolean;
	/** Every mail and storage construct something on the stage reads. */
	services?: readonly ServiceDeclaration[];
	/** Every third party's credentials something on the stage reads. */
	credentials?: readonly CredentialDeclaration[];
	/** The stage's base domain, for the examples. */
	domain?: string;
	/** What the stage's providers say — see {@link StageProviderNotes}. */
	providers?: StageProviderNotes;
	/**
	 * The stage serves a domain from a server of its own — a compose stage —
	 * so its secrets hold the server's address, `GKM_SERVER_IPV4`.
	 */
	server?: boolean;
}

/**
 * Every key a stage must be given rather than derive — the one list both a
 * deploy's checks and `gkm secrets:add` read, so what a deploy refuses and
 * what the builder offers cannot drift.
 *
 * - Deployed, mail is its URL and its sending address, a bucket its URL, and
 *   a file server its public URL. Locally all of it is Mailpit and MinIO.
 * - On every stage, a third party's credentials: nobody but the third party
 *   can issue them.
 *
 * Never a derived value: a database URL, a generated secret, the seed.
 */
export function requiredStageKeys(input: StageKeysInput): StageKey[] {
	const domain = input.domain ?? 'example.com';
	const keys: StageKey[] = [];
	const add = (entry: StageKey) => {
		if (!keys.some((k) => k.key === entry.key)) keys.push(entry);
	};
	const byId = <T extends { id: string }>(list: readonly T[] | undefined) =>
		[...(list ?? [])].sort((a, b) => a.id.localeCompare(b.id));
	const apps = (d: { apps?: readonly string[] }) =>
		d.apps?.length ? { apps: [...d.apps].sort() } : {};

	if (!input.local) {
		const services = byId(input.services);
		// A kind a provider backs on the stage has no dev service, and a key of
		// it names what creates it.
		const objects = input.providers?.objects;
		const storage = objects?.accounted
			? objects.hint
				? { hint: objects.hint }
				: {}
			: { service: 'minio' as const };
		for (const d of services.filter((d) => d.kind === 'email')) {
			add({
				key: provideKey(d.id, 'url'),
				id: d.id,
				kind: 'email',
				what: `where '${d.id}' sends mail — any SMTP server`,
				example: `smtp://user:password@smtp.${domain}:587`,
				service: 'mailpit',
				...apps(d),
			});
			add({
				key: provideKey(d.id, 'from'),
				id: d.id,
				kind: 'email',
				what: `the address '${d.id}' sends from, on a domain the mail server has verified`,
				example: `noreply@${domain}`,
				service: 'mailpit',
				...apps(d),
			});
		}
		for (const d of services.filter((d) => d.kind === 'objects')) {
			add({
				key: provideKey(d.id, 'url'),
				id: d.id,
				kind: 'bucket',
				what: `the bucket '${d.id}' — S3, R2, or any S3-compatible store (add &endpoint=… for one that is not S3)`,
				note: `credentials are optional: a key for this bucket alone in the URL (s3://KEY:SECRET@${appKey(d.id)}?…) wins; without one, the shared AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or a role signs`,
				example: `s3://${appKey(d.id)}?region=eu-west-1`,
				...storage,
				...apps(d),
			});
		}
		for (const d of services.filter((d) => d.kind === 'file-server')) {
			add({
				key: provideKey(d.id, 'url'),
				id: d.id,
				kind: 'file-server',
				what: `the public address '${d.id}' serves its bucket on — a CDN or the bucket's own domain`,
				example: `https://${appKey(d.id)}.${domain}`,
				...storage,
				...(d.of ? { of: d.of } : {}),
				...apps(d),
			});
		}
	}

	if (!input.local && input.server) {
		add({
			key: SERVER_IPV4_KEY,
			id: 'server',
			kind: 'server',
			what: "the public IPv4 address of the server the stage's stack runs on — its hosts' DNS records point at it, and every deploy checks they do",
			note: `${SERVER_IPV6_KEY} adds its IPv6 address (AAAA records); neither is ever handed to an app`,
			example: '203.0.113.10',
		});
	}

	for (const d of byId(input.credentials)) {
		add({
			key: provideKey(d.id, 'credentials'),
			id: d.id,
			kind: d.kind,
			what:
				d.kind === 'external-api'
					? `the credentials '${d.id}' was issued for this stage, as its schema describes them`
					: `the credential '${d.id}', as its schema describes it`,
			example: '{"apiKey":"…"}',
			...apps(d),
		});
	}

	return keys;
}

/**
 * Whether only the stage's secrets can supply `key` to a construct of `kind`
 * — what nothing on the stage derives.
 *
 * A third party's credentials, always. Deployed, also each generated secret
 * and keyring: the stage generated each one once, and every run reads the
 * same value back.
 */
export function suppliedOnly(
	kind: string,
	id: string,
	key: string,
	local: boolean,
): boolean {
	if (kind === 'credential') return true;
	if (kind === 'external-api') return key === provideKey(id, 'credentials');
	if (local) return false;
	return kind === 'secret' || kind === 'encryption';
}

/**
 * Where a deployed stage's mail and storage come from, and what it lacks.
 *
 * - Mail is external once its URL is set, and then needs its sending
 *   address too. Unset, it is Mailpit where allowed — the address derived
 *   unless set — and missing otherwise.
 * - A bucket is external once its URL is set; its credentials, in the URL or
 *   the shared pair, are optional. Unset, it is MinIO where allowed, and
 *   missing otherwise.
 * - A file server's URL is derived where its bucket is MinIO, unless set;
 *   over an external bucket the stage must set it.
 *
 * The keys themselves are {@link requiredStageKeys}'s.
 */
export function externalServices(
	input: ExternalServicesInput,
): ExternalServices {
	const { supplied, allow } = input;
	const has = (key: string) => supplied[key] !== undefined;

	const required = requiredStageKeys({
		local: false,
		services: input.declarations,
		...(input.domain ? { domain: input.domain } : {}),
		...(input.providers ? { providers: input.providers } : {}),
	});

	// A dev service stands in for each construct the stage does not account
	// for: no key in its secrets, and no provider backing its kind.
	const standIn = (k: StageKey) =>
		allow && k.service !== undefined && !has(k.key);
	const mailpit = required
		.filter((k) => k.kind === 'email' && k.key === provideKey(k.id, 'url'))
		.filter(standIn)
		.map((k) => k.id);
	const minio = required
		.filter((k) => k.kind === 'bucket')
		.filter(standIn)
		.map((k) => k.id);

	const covered = (k: StageKey) =>
		(k.kind === 'email' && mailpit.includes(k.id)) ||
		(k.kind === 'bucket' && minio.includes(k.id)) ||
		(k.kind === 'file-server' && k.of !== undefined && minio.includes(k.of));

	const missing = required
		.filter((k) => !has(k.key) && !covered(k))
		.map(
			({
				key,
				id,
				what,
				note,
				example,
				service,
				apps,
				hint,
			}): MissingServiceKey => ({
				key,
				id,
				what,
				...(note ? { note } : {}),
				example,
				...(service ? { service } : {}),
				...(apps ? { apps } : {}),
				...(hint ? { hint } : {}),
			}),
		);

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
