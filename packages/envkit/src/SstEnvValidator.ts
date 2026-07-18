import { EnvironmentBuilder, type InputValue } from './EnvironmentBuilder';
import { type SstResource, sstResolvers } from './SstEnvironmentBuilder';

/**
 * Variables AWS Lambda injects into the runtime. Always valid on AWS, but never
 * assumed — opt in via `platform: 'aws'` or by spreading {@link AWS_RUNTIME_ENV_VARS}
 * into `whitelist`.
 */
export const AWS_RUNTIME_ENV_VARS = [
	'AWS_REGION',
	'AWS_DEFAULT_REGION',
	'AWS_ENDPOINT_URL',
	'AWS_ENDPOINT',
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'AWS_SESSION_TOKEN',
	'AWS_LAMBDA_FUNCTION_NAME',
	'AWS_LAMBDA_FUNCTION_VERSION',
] as const;

/**
 * Variables GCP injects into Cloud Functions / Cloud Run.
 */
export const GCP_RUNTIME_ENV_VARS = [
	'GOOGLE_CLOUD_PROJECT',
	'GCP_PROJECT',
	'FUNCTION_TARGET',
	'FUNCTION_SIGNATURE_TYPE',
	'K_SERVICE',
	'K_REVISION',
	'K_CONFIGURATION',
	'PORT',
] as const;

/**
 * Variables Cloudflare exposes to Workers. Workers inject almost nothing into
 * the global env, so this is intentionally minimal.
 */
export const CLOUDFLARE_RUNTIME_ENV_VARS = [
	'CF_PAGES',
	'CF_PAGES_URL',
] as const;

/**
 * Registry of platform → always-valid runtime variables. Export, don't assume:
 * a caller states the platform it deploys to and the matching set is trusted.
 */
export const PLATFORM_ENV_VARS = {
	aws: AWS_RUNTIME_ENV_VARS,
	gcp: GCP_RUNTIME_ENV_VARS,
	cloudflare: CLOUDFLARE_RUNTIME_ENV_VARS,
} as const;

export type Platform = keyof typeof PLATFORM_ENV_VARS;

/**
 * The always-valid runtime variables for a platform. The "whitelist construct":
 * resolve a platform to its set, to spread into `whitelist` or compare against.
 */
export function platformEnvVars(platform: Platform): readonly string[] {
	return PLATFORM_ENV_VARS[platform];
}

/** How many link-provided vars to list in an error before truncating. */
const MAX_LISTED_VARS = 8;

/** Minimum similarity for a variable to be offered as a "did you mean". */
const SUGGESTION_THRESHOLD = 0.3;

/**
 * Input shape for the validator: the same record `SstEnvironmentBuilder`
 * accepts — keyed by resource name, valued by an SST resource (or a plain
 * string for pass-through env vars).
 */
export type LinkRecord = Record<string, SstResource | InputValue | string>;

export interface ValidationResult {
	valid: boolean;
	/** Requested variables that are not available (excluding optional `?` vars). */
	invalidVars: string[];
	/** Every variable the links + whitelist make available. */
	availableVars: string[];
	/** Nearest available matches for each invalid variable (best first). */
	suggestions: Record<string, string[]>;
}

export interface EnvValidatorOptions {
	/**
	 * Platform whose runtime-injected variables are always valid. Omit to assume
	 * none — the validator never bakes in a platform's variables.
	 */
	platform?: Platform;
	/**
	 * Extra always-valid variables in addition to the platform set — typically
	 * the keys of a function's explicit `environment`.
	 */
	whitelist?: readonly string[];
	/**
	 * Label for the deployable unit (e.g. a function name), used in error
	 * messages so a failure points at exactly one unit.
	 */
	context?: string;
}

/**
 * Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;

	let prev = Array.from({ length: n + 1 }, (_, i) => i);

	for (let i = 1; i <= m; i++) {
		const curr: number[] = [i];
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const del = (prev[j] ?? 0) + 1;
			const ins = (curr[j - 1] ?? 0) + 1;
			const sub = (prev[j - 1] ?? 0) + cost;
			curr[j] = Math.min(del, ins, sub);
		}
		prev = curr;
	}

	return prev[n] ?? 0;
}

/**
 * Similarity in `[0, 1]` combining edit distance with `_`-token overlap, so both
 * near-typos (a missing underscore) and renames (`DATABASE_URL` ~ `DB_URL`,
 * which share the `URL` token) are caught.
 */
function similarity(a: string, b: string): number {
	const editSim = 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

	const ta = new Set(a.split('_').filter(Boolean));
	const tb = new Set(b.split('_').filter(Boolean));
	const shared = [...ta].filter((t) => tb.has(t)).length;
	const union = new Set([...ta, ...tb]).size || 1;
	const tokenSim = shared / union;

	// Nudge token-overlap matches ahead of coincidental edit-distance ones, so a
	// rename like DATABASE_URL prefers DB_URL (shares `URL`) over DB_PASSWORD.
	return Math.max(editSim, tokenSim * 1.15);
}

/**
 * Returns the nearest available variables to `missing`, best first, limited to
 * those above {@link SUGGESTION_THRESHOLD}.
 */
function suggestionsFor(
	missing: string,
	available: readonly string[],
	max = 1,
): string[] {
	return available
		.map((candidate) => ({ candidate, score: similarity(missing, candidate) }))
		.filter((s) => s.score >= SUGGESTION_THRESHOLD)
		.sort((a, b) => b.score - a.score)
		.slice(0, max)
		.map((s) => s.candidate);
}

/**
 * Thrown when a deployable unit requires environment variables its links do not
 * provide. Carries the structured `missing`/`available`/`suggestions` so callers
 * can inspect the failure programmatically, not just read the message.
 */
export class EnvValidationError extends Error {
	readonly isEnvValidationError = true;
	readonly missing: string[];
	readonly available: string[];
	readonly suggestions: Record<string, string[]>;
	readonly context?: string;

	constructor(args: {
		missing: string[];
		available: string[];
		linkVars: string[];
		suggestions: Record<string, string[]>;
		context?: string;
	}) {
		super(EnvValidationError.format(args));
		this.name = 'EnvValidationError';
		this.missing = args.missing;
		this.available = args.available;
		this.suggestions = args.suggestions;
		this.context = args.context;
		// V8-only; keeps the constructor out of the stack trace.
		(
			Error as unknown as {
				captureStackTrace?(target: object, ctor?: unknown): void;
			}
		).captureStackTrace?.(this, EnvValidationError);
	}

	private static format(args: {
		missing: string[];
		linkVars: string[];
		suggestions: Record<string, string[]>;
		context?: string;
	}): string {
		const { missing, linkVars, suggestions, context } = args;
		const who = context ? `'${context}'` : 'a deployable unit';

		const width = Math.max(...missing.map((v) => v.length));
		const lines = missing.map((v) => {
			const hints = suggestions[v] ?? [];
			const hint = hints.length ? `(did you mean ${hints.join(' or ')}?)` : '';
			return `  - ${v.padEnd(width)}  ${hint}`.trimEnd();
		});

		let provided: string;
		if (linkVars.length === 0) {
			provided = '(no links provide environment variables)';
		} else {
			const shown = linkVars.slice(0, MAX_LISTED_VARS).join(', ');
			const extra =
				linkVars.length > MAX_LISTED_VARS
					? ` ...(+${linkVars.length - MAX_LISTED_VARS})`
					: '';
			provided = `Provided by links: ${shown}${extra}`;
		}

		return `${who} is missing required env vars:\n${lines.join('\n')}\n\n${provided}`;
	}
}

/**
 * Derives the set of environment-variable **keys** a group of linked resources
 * will produce at runtime — without resolving any value.
 *
 * This reuses the runtime resolvers (`sstResolvers`) via {@link EnvironmentBuilder},
 * so the keys computed here are exactly the keys a deployed function receives:
 * the validator and the runtime resolution share a single source of truth and
 * cannot drift. Because every resolver's output keys depend only on the record
 * key and the resource `type` (never the value), each resource is reduced to
 * `{ type }` before building, so no SST `Output` is ever read.
 *
 * @example
 * resolveEnvKeys({ db: { type: ResourceType.Postgres } });
 * // ['DB_NAME', 'DB_HOST', 'DB_PASSWORD', 'DB_PORT', 'DB_USERNAME', 'DB_URL']
 */
export function resolveEnvKeys(record: LinkRecord): string[] {
	const typeOnly: Record<string, InputValue> = {};
	for (const [key, value] of Object.entries(record)) {
		typeOnly[key] = typeof value === 'string' ? '' : { type: value.type };
	}
	return Object.keys(new EnvironmentBuilder(typeOnly, sstResolvers).build());
}

/**
 * Validates that the environment variables a deployable unit requires are
 * actually provided by its linked resources — at infra time, before deploy.
 *
 * Available variables are the union of the keys derived from `links`
 * ({@link resolveEnvKeys}), the chosen platform's runtime variables (only when
 * `options.platform` is set — nothing is assumed), and any `options.whitelist`
 * (e.g. the keys of a function's explicit `environment`). A requested variable
 * suffixed with `?` is treated as optional and never causes a failure.
 *
 * @example
 * const validator = new EnvValidator(
 *   { db: { type: ResourceType.Postgres } },
 *   { platform: 'aws', whitelist: ['APP_NAME'], context: 'orders-fn' },
 * );
 * validator.assert(['DB_HOST', 'AWS_REGION', 'APP_NAME', 'SENTRY_DSN?']); // ok
 * validator.assert(['DATABASE_URL']); // throws EnvValidationError (did you mean DB_URL?)
 */
export class EnvValidator {
	/** Every variable available — link-derived, platform, and extra whitelist. */
	readonly availableVars: string[];
	/** Just the variables the links provide (used for error context). */
	readonly linkVars: string[];
	readonly context?: string;
	private readonly availableSet: Set<string>;
	/** Per-link (record key → its env-var keys), for least-privilege filtering. */
	private readonly linkVarsByName: Map<string, string[]>;

	constructor(links: LinkRecord, options: EnvValidatorOptions = {}) {
		const { platform, whitelist = [], context } = options;
		this.context = context;
		this.linkVarsByName = new Map(
			Object.entries(links).map(([name, value]) => [
				name,
				resolveEnvKeys({ [name]: value }),
			]),
		);
		this.linkVars = [...this.linkVarsByName.values()].flat();
		this.availableVars = [
			...this.linkVars,
			...(platform ? PLATFORM_ENV_VARS[platform] : []),
			...whitelist,
		];
		this.availableSet = new Set(this.availableVars);
	}

	/**
	 * Returns the names of the links that provide at least one of the requested
	 * variables — so a construct can attach only the links a unit actually needs
	 * (least privilege) rather than the whole pool. Trailing `?` is ignored.
	 */
	getProvidersForEnvVars(requestedEnvVars: readonly string[]): string[] {
		const requested = new Set(
			requestedEnvVars.map((v) => (v.endsWith('?') ? v.slice(0, -1) : v)),
		);
		const providers: string[] = [];
		for (const [name, vars] of this.linkVarsByName) {
			if (vars.some((v) => requested.has(v))) providers.push(name);
		}
		return providers;
	}

	/**
	 * Checks every requested variable against the available set. Variables
	 * ending in `?` are optional and never reported as invalid. Invalid
	 * variables come back with their nearest available matches.
	 */
	validate(requestedEnvVars: readonly string[]): ValidationResult {
		const invalidVars = requestedEnvVars.filter((envVar) => {
			if (envVar.endsWith('?')) return false;
			return !this.availableSet.has(envVar);
		});

		const suggestions: Record<string, string[]> = {};
		for (const envVar of invalidVars) {
			const matches = suggestionsFor(envVar, this.availableVars);
			if (matches.length) suggestions[envVar] = matches;
		}

		return {
			valid: invalidVars.length === 0,
			invalidVars,
			availableVars: this.availableVars,
			suggestions,
		};
	}

	/**
	 * Asserts that every requested variable is available, throwing an
	 * {@link EnvValidationError} otherwise. Intended to run in a construct's
	 * constructor so a misconfigured `sst.config.ts` fails at synth time, before
	 * any AWS call.
	 */
	assert(requestedEnvVars: readonly string[]): void {
		const { valid, invalidVars, suggestions } = this.validate(requestedEnvVars);

		if (!valid) {
			throw new EnvValidationError({
				missing: invalidVars,
				available: this.availableVars,
				linkVars: this.linkVars,
				suggestions,
				context: this.context,
			});
		}
	}

	/**
	 * Whether a single variable is available. Does not treat a trailing `?` as
	 * optional — pass the bare name.
	 */
	has(envVar: string): boolean {
		return this.availableSet.has(envVar);
	}
}
