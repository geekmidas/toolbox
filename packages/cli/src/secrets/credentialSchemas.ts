/**
 * A third party's credentials, checked against the schema of the construct
 * that reads them — before they are stored, and before a deploy builds
 * anything with them.
 *
 * The schema lives on the construct (`ExternalApi.credentialsSchema`,
 * `Credential.credentialsSchema`), which is the project's code. So the
 * constructs are loaded where a deploy loads them: in the run's sandbox when
 * there is one, here otherwise. What comes back is data only — each schema as
 * JSON Schema where it can say so, and `{ ok, issues }` for each value asked
 * about — because a live schema cannot cross an isolating sandbox. A value
 * asked about goes in as a secret file, never an argument, and no issue
 * carries it back: an issue is a path and a message.
 */

import { decodeCredentials } from '@geekmidas/constructs/credential';
import { type ConstructManifest, provideKey } from '@geekmidas/manifest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';
import { GkmError } from '../errors';
import {
	ConstructDiscoveryFailed,
	type ConstructSource,
	discover,
} from '../reconcile/discover';
import { activeSandbox } from '../sandbox/sandbox';
import { runWorker } from '../sandbox/worker';

/** One thing a schema refused: where in the value, and why. */
export interface CredentialIssue {
	/** Dotted, from the value's root — `apiKey`, `keys.0`; empty for the root. */
	path: string;
	message: string;
}

/** What a candidate value came to. */
export interface CredentialCheck {
	ok: boolean;
	issues: CredentialIssue[];
}

/** A construct's credentials key, and its schema as data. */
export interface CredentialSchemaInfo {
	key: string;
	id: string;
	kind: 'external-api' | 'credential';
	/**
	 * The schema as JSON Schema, where the schema can say — zod's, or any
	 * Standard JSON Schema. Absent otherwise: the value is asked for as JSON.
	 */
	jsonSchema?: Record<string, unknown>;
}

/** What loading the constructs answers. */
export interface CredentialInspection {
	schemas: CredentialSchemaInfo[];
	/** Each value asked about, by key. */
	checks: Record<string, CredentialCheck>;
}

/** A construct whose credentials have a schema. */
interface LiveCredential {
	key: string;
	id: string;
	kind: 'external-api' | 'credential';
	schema: StandardSchemaV1;
}

/** The credentials keys a manifest declares, by the construct that reads each. */
export function credentialKeys(
	manifest: ConstructManifest,
): { key: string; id: string; kind: 'external-api' | 'credential' }[] {
	return Object.entries(manifest).flatMap(([id, declaration]) =>
		declaration.kind === 'external-api' || declaration.kind === 'credential'
			? [{ key: provideKey(id, 'credentials'), id, kind: declaration.kind }]
			: [],
	);
}

/** The constructs that read a third party's credentials, with their schemas. */
export function liveCredentials(
	manifest: ConstructManifest,
	sources: Readonly<Record<string, ConstructSource>>,
): LiveCredential[] {
	return credentialKeys(manifest).flatMap(({ key, id, kind }) => {
		const schema = (sources[id]?.construct as { credentialsSchema?: unknown })
			?.credentialsSchema;
		return isStandardSchema(schema) ? [{ key, id, kind, schema }] : [];
	});
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as StandardSchemaV1)['~standard']?.validate === 'function'
	);
}

/**
 * A schema as JSON Schema: through the Standard JSON Schema extension where
 * the schema has it, as zod 4's does, else zod's own converter — or nothing,
 * for a schema neither can describe.
 */
export function jsonSchemaOf(
	schema: StandardSchemaV1,
): Record<string, unknown> | undefined {
	const standard = schema['~standard'] as StandardSchemaV1['~standard'] & {
		jsonSchema?: {
			input?: (options: { target: string }) => Record<string, unknown>;
		};
	};
	try {
		const described = standard.jsonSchema?.input?.({
			target: 'draft-2020-12',
		});
		if (described) return described;
	} catch {
		// A type JSON Schema cannot express: try zod's converter, then nothing.
	}
	if (typeof schema === 'object' && schema !== null && '_zod' in schema) {
		try {
			return z.toJSONSchema(schema as unknown as z.ZodType, {
				io: 'input',
			}) as Record<string, unknown>;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** A stored value against its schema, read the way the construct reads it. */
export async function checkCredential(
	schema: StandardSchemaV1,
	raw: string,
): Promise<CredentialCheck> {
	const result = await schema['~standard'].validate(decodeCredentials(raw));
	if (!result.issues) return { ok: true, issues: [] };
	return {
		ok: false,
		issues: result.issues.map((issue) => ({
			path: (issue.path ?? [])
				.map((segment) =>
					typeof segment === 'object' ? String(segment.key) : String(segment),
				)
				.join('.'),
			message: issue.message,
		})),
	};
}

/** What a set of live credentials says about some values: data only. */
export async function inspectLive(
	live: readonly LiveCredential[],
	values: Readonly<Record<string, string>>,
): Promise<CredentialInspection> {
	const checks: Record<string, CredentialCheck> = {};
	for (const credential of live) {
		const value = values[credential.key];
		if (value === undefined) continue;
		checks[credential.key] = await checkCredential(credential.schema, value);
	}
	return {
		schemas: live.map(({ key, id, kind, schema }) => {
			const jsonSchema = jsonSchemaOf(schema);
			return { key, id, kind, ...(jsonSchema ? { jsonSchema } : {}) };
		}),
		checks,
	};
}

export interface InspectOptions {
	/** The workspace root. */
	root: string;
	/** Its construct globs. */
	patterns: readonly string[];
	/** The values to check, by key. Only credentials keys are looked at. */
	values?: Readonly<Record<string, string>>;
}

const Issue = z.object({ path: z.string(), message: z.string() });

/** What the credentials worker answers. Checked: the worker ran project code. */
const CredentialsAnswer = z.discriminatedUnion('reason', [
	z.object({
		reason: z.literal('inspected'),
		schemas: z.array(
			z.object({
				key: z.string(),
				id: z.string(),
				kind: z.enum(['external-api', 'credential']),
				jsonSchema: z.record(z.string(), z.unknown()).optional(),
			}),
		),
		checks: z.record(
			z.string(),
			z.object({ ok: z.boolean(), issues: z.array(Issue) }),
		),
	}),
	z.object({
		reason: z.literal('failed'),
		error: z.object({ name: z.string(), message: z.string() }).loose(),
	}),
]);

/** How long loading the constructs to check credentials may take. */
const INSPECT_TIMEOUT_MS = 60_000;

/**
 * The workspace's credential schemas, and what each of `values` comes to —
 * loaded in the run's sandbox when there is one, here otherwise.
 */
export async function inspectCredentials(
	options: InspectOptions,
): Promise<CredentialInspection> {
	const sandbox = activeSandbox();
	if (!sandbox) {
		return (await loadCredentialSchemasHere(options)).inspect(
			options.values ?? {},
		);
	}

	const secrets = Object.fromEntries(
		Object.entries(options.values ?? {}).filter(([key]) =>
			key.endsWith('_CREDENTIALS'),
		),
	);
	const { value } = await runWorker(sandbox, 'credentials check', {
		name: 'credentials-worker',
		args: [JSON.stringify({ patterns: options.patterns, cwd: options.root })],
		cwd: options.root,
		timeoutMs: INSPECT_TIMEOUT_MS,
		schema: CredentialsAnswer,
		...(Object.keys(secrets).length > 0 ? { secrets } : {}),
	});
	if (value.reason === 'failed') {
		throw new ConstructDiscoveryFailed(value.error.name, value.error.message);
	}
	const { schemas, checks } = value;
	return {
		schemas: schemas.map(({ jsonSchema, ...rest }) => ({
			...rest,
			...(jsonSchema ? { jsonSchema } : {}),
		})),
		checks,
	};
}

/** The constructs loaded once, here, and asked about as often as needed. */
async function loadCredentialSchemasHere(options: InspectOptions): Promise<{
	inspect(
		values: Readonly<Record<string, string>>,
	): Promise<CredentialInspection>;
}> {
	const sources: Record<string, ConstructSource> = {};
	const manifest = await discover({
		patterns: [...options.patterns],
		cwd: options.root,
		sources,
	});
	const live = liveCredentials(manifest, sources);
	return { inspect: (values) => inspectLive(live, values) };
}

/** The schemas, and a check of one candidate value at a time. */
export interface CredentialSchemas {
	schemas: CredentialSchemaInfo[];
	/** `raw` against `key`'s schema; ok for a key no schema describes. */
	check(key: string, raw: string): Promise<CredentialCheck>;
}

/**
 * The workspace's credential schemas, for a command that checks values one
 * at a time as they are typed. In-process the constructs are loaded once;
 * in a sandbox each check is a run of the worker.
 */
export async function loadCredentialSchemas(
	options: Omit<InspectOptions, 'values'>,
): Promise<CredentialSchemas> {
	const here = activeSandbox()
		? undefined
		: await loadCredentialSchemasHere(options);
	const inspect = (values: Readonly<Record<string, string>>) =>
		here ? here.inspect(values) : inspectCredentials({ ...options, values });

	const { schemas } = await inspect({});
	return {
		schemas,
		async check(key, raw) {
			if (!schemas.some((s) => s.key === key)) return { ok: true, issues: [] };
			const { checks } = await inspect({ [key]: raw });
			return checks[key] ?? { ok: true, issues: [] };
		},
	};
}

/** One stored credential its schema refuses. */
export interface InvalidCredential {
	key: string;
	issues: CredentialIssue[];
}

/** An issue as the line that names it: `SHIPPING_CREDENTIALS.apiKey: …`. */
export function issueLine(key: string, issue: CredentialIssue): string {
	return `${key}${issue.path ? `.${issue.path}` : ''}: ${issue.message}`;
}

/**
 * Credentials their construct's schema refuses — on their way into the
 * stage's secrets, or already there when a deploy reads them. The values are
 * never in the message: only where each is wrong, and why.
 */
export class CredentialsInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly invalid: readonly InvalidCredential[],
		/** Whether a value was being set (and was not saved), or deployed. */
		readonly during: 'set' | 'deploy',
	) {
		const lines = invalid.flatMap(({ key, issues }) =>
			issues.map((issue) => `  ${issueLine(key, issue)}`),
		);
		const keys = invalid.map((i) => i.key);
		super(
			during === 'set'
				? `${keys.join(', ')} is not what its construct's schema describes, ` +
						`so nothing was saved:\n\n${lines.join('\n')}\n\n` +
						`Set a value that matches, or let gkm ask for each field: ` +
						`gkm secrets:add --stage ${stage}`
				: `The stage '${stage}' holds ${keys.length === 1 ? 'a credential' : 'credentials'} ` +
						`${keys.length === 1 ? "its construct's schema refuses" : "their constructs' schemas refuse"}, ` +
						`and every app reading ${keys.length === 1 ? 'it' : 'them'} would fail ` +
						`as it starts:\n\n${lines.join('\n')}\n\n` +
						`Set ${keys.length === 1 ? 'it' : 'them'} again, field by field: ` +
						`gkm secrets:add --stage ${stage}`,
		);
		this.name = 'CredentialsInvalid';
	}
}

/**
 * Every credential the stage holds for a construct, against its schema —
 * before a deploy builds anything with one the app would refuse as it
 * starts. Loads nothing when the stage holds none.
 *
 * @throws {CredentialsInvalid} naming each key and every issue
 */
export async function assertStageCredentials(options: {
	root: string;
	patterns: readonly string[];
	manifest: ConstructManifest;
	stage: string;
	supplied: Readonly<Record<string, string>>;
}): Promise<void> {
	const values = Object.fromEntries(
		credentialKeys(options.manifest)
			.map(({ key }) => [key, options.supplied[key]] as const)
			.filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
	if (Object.keys(values).length === 0) return;

	const { checks } = await inspectCredentials({
		root: options.root,
		patterns: options.patterns,
		values,
	});
	const invalid = Object.entries(checks)
		.filter(([, check]) => !check.ok)
		.map(([key, check]) => ({ key, issues: check.issues }))
		.sort((a, b) => a.key.localeCompare(b.key));
	if (invalid.length > 0) {
		throw new CredentialsInvalid(options.stage, invalid, 'deploy');
	}
}
