/**
 * Stored secrets an older gkm generated that now shadow a derived value.
 *
 * Before constructs, initialising a stage wrote an address for each app into
 * its custom secrets: `<APP>_DATABASE_URL` as a `postgresql://…@localhost`
 * URL with a password of its own, and `http://localhost:<port>` for a site or
 * an auth server. Those keys are now a construct's — `database.schema('AuthDatabase')`
 * provides `AUTH_DATABASE_URL`, `new BetterAuth('Auth')` provides `AUTH_URL`
 * — and a deploy derives them. A value the stage holds is a value set by hand,
 * and set by hand wins: the container is handed `localhost`, where nothing
 * answers, with a password no role has.
 *
 * So a deploy refuses such a stage rather than run it, naming each key and
 * the command that removes it. Nothing is deleted for the user: the value is
 * theirs, and only they can say it is stale. A URL that names a real host — a
 * managed database — is a deliberate choice and still wins.
 */

import {
	type ConstructManifest,
	type DeclarationKind,
	providedKeyFor,
} from '@geekmidas/manifest';

/** The kinds whose URL an older gkm wrote into a stage's secrets. */
const ADDRESSED: ReadonlySet<DeclarationKind> = new Set<DeclarationKind>([
	'database',
	'database-reader',
	'database-schema',
	'rest-api',
	'site',
]);

/** Hosts that are this machine — never anything, inside a container. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** One stored key that shadows a construct's derived value. */
export interface StaleSecret {
	key: string;
	/** The construct that provides the key. */
	construct: string;
	/** The host the stored value names — never the value itself. */
	host: string;
}

/**
 * A stage holds a construct's address as a custom secret, pointing at
 * `localhost` — what an older `gkm secrets:init`, `gkm setup` or `gkm init`
 * generated. Set by hand wins over derived, so the app would be handed it.
 */
export class StaleStageSecrets extends Error {
	constructor(
		readonly stage: string,
		readonly stale: readonly StaleSecret[],
	) {
		const one = stale.length === 1;
		super(
			`The stage '${stage}' holds ${one ? 'a value' : 'values'} an older gkm generated ` +
				`for ${one ? 'an address a construct' : 'addresses constructs'} now ${one ? 'provides' : 'provide'}:\n` +
				stale
					.map(
						(s) => `  ${s.key}: ${s.construct}'s, stored pointing at ${s.host}`,
					)
					.join('\n') +
				`\nA stored value wins over the derived one, so the app would be handed ` +
				`an address where nothing answers inside its container. Remove ` +
				`${one ? 'it' : 'each'}, and the construct's own value is used:\n` +
				stale
					.map((s) => `  gkm secrets:unset ${s.key} --stage ${stage}`)
					.join('\n') +
				'\nA managed service set with its real host is not affected.',
		);
		this.name = 'StaleStageSecrets';
	}
}

/** The host a stored value names, if it is a URL. */
function hostOf(value: string): string | undefined {
	try {
		return new URL(value).hostname;
	} catch {
		return undefined;
	}
}

/**
 * Each stored key that a construct provides an address for, holding an
 * address on this machine.
 */
export function staleStageSecrets(
	manifest: ConstructManifest,
	supplied: Readonly<Record<string, string>>,
): StaleSecret[] {
	const stale: StaleSecret[] = [];
	for (const [id, declaration] of Object.entries(manifest)) {
		if (!ADDRESSED.has(declaration.kind)) continue;
		const key = providedKeyFor(id, declaration.kind, 'url');
		const value = supplied[key];
		if (value === undefined) continue;
		const host = hostOf(value);
		if (host === undefined || !LOOPBACK.has(host)) continue;
		stale.push({ key, construct: id, host });
	}
	return stale.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Refuse a stage whose stored secrets would shadow a construct's address with
 * `localhost`.
 *
 * @throws {StaleStageSecrets} naming each key and the command removing it
 */
export function assertNoStaleSecrets(options: {
	manifest: ConstructManifest;
	stage: string;
	supplied: Readonly<Record<string, string>>;
}): void {
	const stale = staleStageSecrets(options.manifest, options.supplied);
	if (stale.length > 0) throw new StaleStageSecrets(options.stage, stale);
}
