/**
 * `gkm secrets:add --stage <stage>` — the secrets a stage must be given,
 * built key by key.
 *
 * It offers exactly the keys a deploy would refuse the stage without
 * (`requiredStageKeys`), across every app in the workspace, each once: the
 * stage's buckets, mail and file servers where it is deployed, and every
 * third party's credentials. A key is built by what it is — a bucket from its
 * provider, mail from its SMTP server, credentials field by field from their
 * construct's schema — checked, and saved through the stage's own store, the
 * one `gkm secrets:set` writes. No value is ever printed.
 *
 * `--json` asks nothing: it prints the keys, for a script or an agent to set
 * with `gkm secrets:set`.
 */

import { isIPv4, isIPv6 } from 'node:net';
import {
	type S3Address,
	build as s3Build,
	parse as s3Parse,
} from '@geekmidas/storage/s3-url';
import prompts, { type PromptObject } from 'prompts';
import { z } from 'zod';
import { SERVER_IPV4_KEY, SERVER_IPV6_KEY } from '../compose/dnsConfig.js';
import { loadWorkspaceSettings } from '../config';
import { deploysWithCompose } from '../providers/dns.js';
import { stageProviderNotes } from '../providers/notes.js';
import { discover } from '../reconcile/discover';
import { constructGlobs } from '../reconcile/workspace';
import { assertDeployedStage } from '../workspace/stages';
import {
	type CredentialSchemaInfo,
	type CredentialSchemas,
	issueLine,
	loadCredentialSchemas,
} from './credentialSchemas';
import { type WorkspaceStageKey, workspaceStageKeys } from './stageKeys';
import { initStageSecrets } from './storage';
import { secretsStoreFor } from './store';

export interface SecretsAddOptions {
	stage: string;
	/** Only the keys the stage has not set. */
	missing?: boolean;
	/** Print the keys as JSON and ask nothing. */
	json?: boolean;
	/** The workspace — the current directory when absent. */
	cwd?: string;
	/** The CLI's home, for a file store's keys. Defaults to `GKM_HOME`. */
	home?: string;
}

/** Where the command writes, and whether there is anyone to ask. */
export interface SecretsAddIo {
	/** A line for the person at the terminal. */
	log(line: string): void;
	/** `--json`'s output. */
	write(chunk: string): void;
	/** Whether prompts can be answered. */
	interactive: boolean;
}

/** What a run of the command came to. */
export interface SecretsAddResult {
	/** The keys offered. */
	keys: WorkspaceStageKey[];
	/** The keys saved, in the order they were built. */
	saved: string[];
}

/** One key as `--json` prints it. */
export interface StageKeyJson {
	key: string;
	kind: WorkspaceStageKey['kind'];
	construct: string;
	apps: string[];
	set: boolean;
}

/** `gkm secrets:add` with nobody at a terminal to answer it. */
export class SecretsAddNeedsTerminal extends Error {
	constructor(readonly stage: string) {
		super(
			`gkm secrets:add asks for each key, and there is no terminal to ask ` +
				`at. List what the stage needs with ` +
				`gkm secrets:add --stage ${stage} --missing --json, and set each ` +
				`with gkm secrets:set <KEY> <value> --stage ${stage}.`,
		);
		this.name = 'SecretsAddNeedsTerminal';
	}
}

/** The person stopped the builder; nothing was saved. */
export class SecretsAddCancelled extends Error {
	constructor(readonly stage: string) {
		super(`Stopped. Nothing was saved to the stage '${stage}'.`);
		this.name = 'SecretsAddCancelled';
	}
}

const defaultIo = (): SecretsAddIo => ({
	log: (line) => console.log(line),
	write: (chunk) => {
		process.stdout.write(chunk);
	},
	interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
});

/** `gkm secrets:add`. */
export async function secretsAddCommand(
	options: SecretsAddOptions,
	io: SecretsAddIo = defaultIo(),
): Promise<SecretsAddResult> {
	const { stage } = options;
	const workspace = await loadWorkspaceSettings(options.cwd ?? process.cwd());
	const local = stage === workspace.stages.local;
	if (!local) assertDeployedStage(workspace.stages, stage);

	const patterns = constructGlobs(workspace);
	const runnables: Record<string, string[]> = {};
	const manifest = await discover({
		patterns,
		cwd: workspace.root,
		runnables,
	});

	const store = await secretsStoreFor(workspace, stage, {
		...(options.home ? { home: options.home } : {}),
	});
	const stored = await store.read(stage);
	const domain = workspace.domains?.[stage];

	const all = workspaceStageKeys({
		manifest,
		runnables,
		local,
		supplied: stored?.custom ?? {},
		...(domain ? { domain } : {}),
		providers: stageProviderNotes(workspace, stage),
		// A compose stage that serves a domain names its server.
		...(!local && domain && deploysWithCompose(workspace)
			? { server: true }
			: {}),
	});
	const keys = options.missing ? all.filter((k) => !k.set) : all;

	if (options.json) {
		const listed: StageKeyJson[] = keys.map((k) => ({
			key: k.key,
			kind: k.kind,
			construct: k.id,
			apps: [...(k.apps ?? [])],
			set: k.set,
		}));
		io.write(`${JSON.stringify(listed, null, 2)}\n`);
		return { keys, saved: [] };
	}

	if (!io.interactive) throw new SecretsAddNeedsTerminal(stage);

	if (keys.length === 0) {
		io.log(
			all.length === 0
				? `Nothing to add: no construct on '${stage}' needs a key only the stage can supply.`
				: `Nothing to add: the stage '${stage}' has every key it needs.`,
		);
		return { keys, saved: [] };
	}

	const ask = asker(stage);
	const chosen: string[] = await ask({
		type: 'multiselect',
		message: `Which keys for '${stage}'? (${store.name} store)`,
		choices: keys.map((k) => ({
			title: `${k.key}  ${KIND_LABEL[k.kind]} '${k.id}'${k.apps?.length ? ` · ${k.apps.join(', ')}` : ''}${k.set ? ' · set' : ''}`,
			value: k.key,
			selected: !k.set,
		})),
		instructions: false,
		hint: 'space to toggle, enter to continue',
	});
	const selected = keys.filter((k) => (chosen ?? []).includes(k.key));

	const values: Record<string, string> = {};
	const has = (key: string) =>
		values[key] !== undefined || stored?.custom?.[key] !== undefined;
	let schemas: CredentialSchemas | undefined;

	for (const entry of selected) {
		if (entry.set) {
			const overwrite: boolean = await ask({
				type: 'confirm',
				message: `${entry.key} is set. Replace it?`,
				initial: false,
			});
			if (!overwrite) continue;
		}
		io.log(`\n${entry.key} — ${entry.what}`);
		if (entry.hint) io.log(`  ${entry.hint}`);

		switch (entry.kind) {
			case 'bucket':
				Object.assign(values, await buildBucket(ask, io, entry, has));
				break;
			case 'email':
				values[entry.key] = entry.key.endsWith('_FROM')
					? await askFrom(ask, io)
					: await buildSmtpUrl(ask, io);
				break;
			case 'file-server':
				values[entry.key] = await askHttpUrl(ask, io, 'Its public URL');
				break;
			case 'server':
				Object.assign(values, await buildServer(ask, io, has));
				break;
			case 'external-api':
			case 'credential':
				schemas ??= await loadCredentialSchemas({
					root: workspace.root,
					patterns,
				});
				values[entry.key] = await buildCredentials(ask, io, entry, schemas);
				break;
		}
	}

	const saved = Object.keys(values);
	if (saved.length === 0) {
		io.log('\nNothing was saved.');
		return { keys, saved };
	}

	const base = stored ?? initStageSecrets(stage);
	await store.write(stage, {
		...base,
		updatedAt: new Date().toISOString(),
		custom: { ...base.custom, ...values },
	});
	io.log(
		`\n✓ Saved ${saved.join(', ')} to the stage '${stage}' (${store.name} store).`,
	);
	return { keys, saved };
}

const KIND_LABEL: Record<WorkspaceStageKey['kind'], string> = {
	bucket: 'bucket',
	email: 'email',
	'file-server': 'file server',
	'external-api': 'external API',
	credential: 'credential',
	server: 'server address',
};

/** The server's IPv4 address, and — if it has one — its IPv6 address. */
async function buildServer(
	ask: Ask,
	io: SecretsAddIo,
	has: (key: string) => boolean,
): Promise<Record<string, string>> {
	const ipv4 = text(
		await askUntil<string>(
			ask,
			io,
			{ type: 'text', message: "The server's public IPv4 address" },
			(value) =>
				isIPv4(text(value))
					? undefined
					: 'An IPv4 address is required, e.g. 203.0.113.10.',
		),
	);
	const values: Record<string, string> = { [SERVER_IPV4_KEY]: ipv4 };
	if (has(SERVER_IPV6_KEY)) return values;
	const ipv6 = text(
		await askUntil<string>(
			ask,
			io,
			{
				type: 'text',
				message: 'Its public IPv6 address (empty for none — no AAAA records)',
			},
			(value) =>
				!text(value) || isIPv6(text(value))
					? undefined
					: 'An IPv6 address, e.g. 2001:db8::10, or nothing.',
		),
	);
	if (ipv6) values[SERVER_IPV6_KEY] = ipv6;
	return values;
}

/** One question, answered — or the run stopped. */
type Ask = <T = string>(question: Omit<PromptObject, 'name'>) => Promise<T>;

function asker(stage: string): Ask {
	return async <T>(question: Omit<PromptObject, 'name'>) => {
		const answers = await prompts(
			{ ...question, name: 'value' } as PromptObject,
			{
				onCancel: () => {
					throw new SecretsAddCancelled(stage);
				},
			},
		);
		return answers.value as T;
	};
}

/** Ask until `accept` takes the answer; `accept` returns why it did not. */
async function askUntil<T>(
	ask: Ask,
	io: SecretsAddIo,
	question: Omit<PromptObject, 'name'>,
	accept: (value: T) => string | undefined,
): Promise<T> {
	for (;;) {
		const value = await ask<T>(question);
		const problem = accept(value);
		if (!problem) return value;
		io.log(`  ✗ ${problem}`);
	}
}

const required =
	(what: string) =>
	(value: string | undefined): string | undefined =>
		value?.trim() ? undefined : `${what} is required.`;

const text = (value: unknown) => String(value ?? '').trim();

/** An `http(s)://` URL. */
const HttpUrl = z.url({ protocol: /^https?$/ });

async function askHttpUrl(
	ask: Ask,
	io: SecretsAddIo,
	message: string,
): Promise<string> {
	return text(
		await askUntil<string>(ask, io, { type: 'text', message }, (value) =>
			HttpUrl.safeParse(text(value)).success
				? undefined
				: 'An http:// or https:// URL is required.',
		),
	);
}

async function askFrom(ask: Ask, io: SecretsAddIo): Promise<string> {
	return text(
		await askUntil<string>(
			ask,
			io,
			{ type: 'text', message: 'The address it sends from' },
			(value) =>
				z.email().safeParse(text(value)).success
					? undefined
					: 'An email address is required, e.g. noreply@example.com.',
		),
	);
}

/**
 * An SMTP server as the URL `@geekmidas/emailkit` reads: `smtp://` for
 * STARTTLS, `smtps://` for TLS from the first byte, with the user and
 * password percent-encoded.
 */
async function buildSmtpUrl(ask: Ask, io: SecretsAddIo): Promise<string> {
	const host = text(
		await askUntil<string>(
			ask,
			io,
			{ type: 'text', message: 'SMTP host' },
			required('The host'),
		),
	);
	const port = await askUntil<string | number>(
		ask,
		io,
		{ type: 'text', message: 'Port', initial: '587' },
		(value) => {
			const n = Number(value);
			return Number.isInteger(n) && n > 0 && n < 65536
				? undefined
				: 'A port number is required.';
		},
	);
	const user = text(
		await ask<string>({ type: 'text', message: 'User (empty for none)' }),
	);
	const password = user
		? await ask<string>({ type: 'password', message: 'Password' })
		: '';
	const tls = await ask<'starttls' | 'tls'>({
		type: 'select',
		message: 'TLS',
		choices: [
			{ title: 'STARTTLS (smtp://, usually port 587)', value: 'starttls' },
			{ title: 'TLS on connect (smtps://, usually port 465)', value: 'tls' },
		],
		initial: 0,
	});

	const url = new URL(`${tls === 'tls' ? 'smtps' : 'smtp'}://${host}`);
	url.port = String(Number(port));
	if (user) {
		url.username = encodeURIComponent(user);
		url.password = encodeURIComponent(password ?? '');
	}
	return url.toString().replace(/\/$/, '');
}

/**
 * A bucket's URL, from its provider — and, optionally, a key for it alone in
 * the URL, or the stage's shared pair. Credentials are never required: without
 * them the SDK's own chain signs, a role included.
 */
async function buildBucket(
	ask: Ask,
	io: SecretsAddIo,
	entry: WorkspaceStageKey,
	has: (key: string) => boolean,
): Promise<Record<string, string>> {
	const provider = await ask<'s3' | 'r2' | 'compatible' | 'url'>({
		type: 'select',
		message: 'Where is the bucket?',
		choices: [
			{ title: 'AWS S3', value: 's3' },
			{ title: 'Cloudflare R2', value: 'r2' },
			{ title: 'MinIO, or another S3-compatible store', value: 'compatible' },
			{ title: 'Paste an s3:// URL', value: 'url' },
		],
		initial: 0,
	});

	const bucketName = async () =>
		text(
			await askUntil<string>(
				ask,
				io,
				{ type: 'text', message: 'Bucket name' },
				required('The bucket name'),
			),
		);

	let address: S3Address;
	switch (provider) {
		case 's3': {
			const bucket = await bucketName();
			const region = text(
				await askUntil<string>(
					ask,
					io,
					{ type: 'text', message: 'Region', initial: 'eu-west-1' },
					required('The region'),
				),
			);
			address = { bucket, region };
			break;
		}
		case 'r2': {
			const account = text(
				await askUntil<string>(
					ask,
					io,
					{
						type: 'text',
						message: 'Cloudflare account id, or the R2 endpoint URL',
					},
					required('The account id or endpoint'),
				),
			);
			const bucket = await bucketName();
			address = {
				bucket,
				region: 'auto',
				endpoint: /^https?:\/\//.test(account)
					? account
					: `https://${account}.r2.cloudflarestorage.com`,
			};
			break;
		}
		case 'compatible': {
			const endpoint = await askHttpUrl(ask, io, 'Endpoint URL');
			const bucket = await bucketName();
			const region = text(
				await ask<string>({
					type: 'text',
					message: 'Region',
					initial: 'us-east-1',
				}),
			);
			const forcePathStyle = await ask<boolean>({
				type: 'confirm',
				message: 'Path-style addressing? (MinIO needs it)',
				initial: true,
			});
			address = {
				bucket,
				...(region ? { region } : {}),
				endpoint,
				...(forcePathStyle ? { forcePathStyle } : {}),
			};
			break;
		}
		case 'url': {
			const pasted = await askUntil<string>(
				ask,
				io,
				{ type: 'password', message: 'The s3:// URL' },
				(value) => {
					try {
						s3Parse(text(value));
						return undefined;
					} catch (error) {
						return `Not an s3:// URL the storage client can read (${(error as Error).name}).`;
					}
				},
			);
			address = s3Parse(text(pasted));
			break;
		}
	}

	if (!address.accessKeyId) {
		const own = await ask<boolean>({
			type: 'confirm',
			message: `A key for '${entry.id}' alone, in its URL? (optional)`,
			initial: false,
		});
		if (own) {
			const accessKeyId = text(
				await askUntil<string>(
					ask,
					io,
					{ type: 'text', message: 'Access key id' },
					required('The access key id'),
				),
			);
			const secretAccessKey = await askUntil<string>(
				ask,
				io,
				{ type: 'password', message: 'Secret access key' },
				required('The secret access key'),
			);
			address = { ...address, accessKeyId, secretAccessKey };
		}
	}

	const values: Record<string, string> = { [entry.key]: s3Build(address) };

	if (!address.accessKeyId && !has('AWS_ACCESS_KEY_ID')) {
		const shared = await ask<boolean>({
			type: 'confirm',
			message:
				"Set the stage's shared AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY? " +
				'(optional: without them a role signs)',
			initial: false,
		});
		if (shared) {
			values.AWS_ACCESS_KEY_ID = text(
				await askUntil<string>(
					ask,
					io,
					{ type: 'text', message: 'AWS_ACCESS_KEY_ID' },
					required('The access key id'),
				),
			);
			values.AWS_SECRET_ACCESS_KEY = await askUntil<string>(
				ask,
				io,
				{ type: 'password', message: 'AWS_SECRET_ACCESS_KEY' },
				required('The secret access key'),
			);
		}
	}

	return values;
}

/** A field whose name says it is a secret, asked for without echo. */
const SECRET_FIELD = /secret|key|token|password/i;

interface JsonSchemaProperty {
	type?: string | string[];
	enum?: unknown[];
	description?: string;
}

/** The properties of an object schema, or nothing for any other shape. */
function objectProperties(
	info: CredentialSchemaInfo | undefined,
):
	| { properties: Record<string, JsonSchemaProperty>; required: string[] }
	| undefined {
	const schema = info?.jsonSchema;
	if (!schema || schema.type !== 'object') return undefined;
	const properties = schema.properties;
	if (!properties || typeof properties !== 'object') return undefined;
	return {
		properties: properties as Record<string, JsonSchemaProperty>,
		required: Array.isArray(schema.required)
			? (schema.required as string[])
			: [],
	};
}

function typesOf(property: JsonSchemaProperty): string[] {
	if (Array.isArray(property.type)) return property.type;
	return property.type ? [property.type] : [];
}

/**
 * Credentials, field by field where the construct's schema is an object it
 * can describe, and as JSON otherwise — checked against the schema itself
 * before anything is kept, and asked again, with each issue's path, until
 * the schema takes it.
 */
async function buildCredentials(
	ask: Ask,
	io: SecretsAddIo,
	entry: WorkspaceStageKey,
	schemas: CredentialSchemas,
): Promise<string> {
	const info = schemas.schemas.find((s) => s.key === entry.key);
	const shape = objectProperties(info);
	if (!info) {
		io.log(
			`  '${entry.id}' exposes no schema to check against; the value is stored as given.`,
		);
	}

	for (;;) {
		const raw = shape
			? JSON.stringify(await askFields(ask, io, shape))
			: text(
					await ask<string>({
						type: 'password',
						message: 'The value, as JSON (or one opaque string)',
					}),
				);

		const check = await schemas.check(entry.key, raw);
		if (check.ok) return raw;
		io.log(`  ✗ The schema of '${entry.id}' refuses it:`);
		for (const issue of check.issues) {
			io.log(`      ${issueLine(entry.key, issue)}`);
		}
		io.log('    Again:');
	}
}

async function askFields(
	ask: Ask,
	io: SecretsAddIo,
	shape: {
		properties: Record<string, JsonSchemaProperty>;
		required: string[];
	},
): Promise<Record<string, unknown>> {
	const value: Record<string, unknown> = {};
	for (const [name, property] of Object.entries(shape.properties)) {
		const optional = !shape.required.includes(name);
		const label = `${name}${optional ? ' (optional)' : ''}${property.description ? ` — ${property.description}` : ''}`;
		const types = typesOf(property);

		if (property.enum?.length) {
			const choices = property.enum.map((option) => ({
				title: String(option),
				value: option,
			}));
			const picked = await ask<unknown>({
				type: 'select',
				message: label,
				choices: optional
					? [{ title: '(none)', value: undefined }, ...choices]
					: choices,
			} as Omit<PromptObject, 'name'>);
			if (picked !== undefined) value[name] = picked;
			continue;
		}

		if (types.includes('boolean')) {
			value[name] = await ask<boolean>({
				type: 'confirm',
				message: label,
				initial: false,
			});
			continue;
		}

		const numeric = types.includes('number') || types.includes('integer');
		const plain = types.length === 0 || types.includes('string');
		const answer = await askUntil<string>(
			ask,
			io,
			{
				type: SECRET_FIELD.test(name) ? 'password' : 'text',
				message: label,
			},
			(given) => {
				const typed = text(given);
				if (!typed) return optional ? undefined : `${name} is required.`;
				if (numeric && !plain && Number.isNaN(Number(typed))) {
					return `${name} is a number.`;
				}
				if (!numeric && !plain) {
					try {
						JSON.parse(typed);
					} catch {
						return `${name} is JSON (${types.join(' or ')}).`;
					}
				}
				return undefined;
			},
		);
		const typed = text(answer);
		if (!typed) continue;
		value[name] = plain ? typed : numeric ? Number(typed) : JSON.parse(typed);
	}
	return value;
}
