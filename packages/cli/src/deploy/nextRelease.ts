/**
 * What every Next.js build gkm runs is handed so a release does not break the
 * tabs the last one opened (#508).
 *
 * - **`NEXT_DEPLOYMENT_ID`**, the release: the image tag on a server stage
 *   (`<commit>-<stage>`), the deploy's tag on AWS. Next reads it at
 *   `next build` as its `deploymentId`, tags every asset and request with it,
 *   and when a tab opened on an older release asks for a chunk the new one
 *   does not have, does a full page load instead of throwing
 *   `ChunkLoadError`. Off Vercel, Next takes the variable over a
 *   `deploymentId` in `next.config` rather than erroring — so a site that
 *   sets one has gkm's.
 * - **`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`**, the stage's: 32 random bytes,
 *   base64, generated on the stage's first deploy and kept in its secrets.
 *   Next derives its server actions' ids and encrypts their closures with
 *   it, so a form submitted from a tab opened before a deploy still finds
 *   its action after it. A deploy never rotates it; `gkm secrets:set` does.
 *
 * Only a Next site that runs a server is handed the key — at build, and on
 * its server at runtime. No other app reads it: it is the stack's
 * (`isStackKey`), never one every process is handed.
 */

import { randomBytes } from 'node:crypto';
import type { ConstructManifest, SiteDeclaration } from '@geekmidas/manifest';

/** The release Next tags a build with: its `deploymentId`. */
export const NEXT_DEPLOYMENT_ID_KEY = 'NEXT_DEPLOYMENT_ID';

/** The stage's server actions key. */
export const NEXT_ACTIONS_KEY = 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY';

/** Whether a site is built by Next. */
export function isNextSite(
	site: Pick<SiteDeclaration, 'variant'> | undefined,
): boolean {
	return site?.variant === 'next';
}

/** Whether any site the manifest declares is built by Next. */
export function hasNextSite(manifest: ConstructManifest): boolean {
	return Object.values(manifest).some(
		(declaration) => declaration?.kind === 'site' && isNextSite(declaration),
	);
}

/** A new {@link NEXT_ACTIONS_KEY}: 32 random bytes, base64, as Next takes it. */
export function newNextActionsKey(): string {
	return randomBytes(32).toString('base64');
}

/**
 * What a site's build is handed for its release: the deployment id, and the
 * stage's actions key where it has one. Nothing for a site Next does not
 * build.
 */
export function nextBuildValues(
	site: Pick<SiteDeclaration, 'variant'> | undefined,
	release: string,
	secrets: Readonly<Record<string, string>>,
): Record<string, string> {
	if (!isNextSite(site)) return {};
	return {
		[NEXT_DEPLOYMENT_ID_KEY]: release,
		...nextRuntimeValues(site, secrets),
	};
}

/**
 * What a Next site's server reads at runtime: the stage's actions key — the
 * one its build was made with. Nothing for any other app.
 */
export function nextRuntimeValues(
	site: Pick<SiteDeclaration, 'variant'> | undefined,
	secrets: Readonly<Record<string, string>>,
): Record<string, string> {
	if (!isNextSite(site)) return {};
	const key = secrets[NEXT_ACTIONS_KEY];
	return key ? { [NEXT_ACTIONS_KEY]: key } : {};
}
