/**
 * The values a deployed stage generates once and keeps: what nothing can
 * provision and nobody else issues.
 *
 * - **A seed**, which salts every password a deploy derives — a database's
 *   master and roles, a bucket's root user. Derived from repo facts alone
 *   (project, stage, construct id), those passwords were computable by anyone
 *   who could read the repo.
 * - **Each `secret` construct's value** — an auth server's signing secret —
 *   random, rather than derived.
 *
 * Both are generated on the first deploy that needs them and written to the
 * stage's store, so every later deploy reads the same values: sessions survive
 * a redeploy, and a role's password does not move. A value set by hand with
 * `gkm secrets:set` is kept, never replaced.
 */

import { randomBytes } from 'node:crypto';
import type { ConstructManifest } from '@geekmidas/manifest';
import type { StageSecrets } from '../secrets/types.js';

export interface GeneratedSecrets {
	/** The stage's secrets with everything it generates present. */
	secrets: StageSecrets;
	/** What was generated this time, by key — empty when nothing was missing. */
	generated: string[];
}

/**
 * The stage's secrets with its seed and every declared `secret`'s value
 * present, generating what is missing. Pure: the caller writes the result
 * back to the stage's store when `generated` is not empty.
 */
export function withGeneratedSecrets(
	secrets: StageSecrets,
	manifest: ConstructManifest,
): GeneratedSecrets {
	const generated: string[] = [];
	const custom = { ...secrets.custom };

	for (const declaration of Object.values(manifest)) {
		if (declaration?.kind !== 'secret') continue;

		const key = declaration.provides?.[0];
		if (!key || custom[key]) continue;

		custom[key] = random();
		generated.push(key);
	}

	const seed = secrets.seed ?? random();
	if (!secrets.seed) generated.push('seed');

	return {
		secrets: generated.length
			? { ...secrets, seed, custom, updatedAt: new Date().toISOString() }
			: secrets,
		generated,
	};
}

/** 256 bits, URL-safe. */
function random(): string {
	return randomBytes(32).toString('base64url');
}
