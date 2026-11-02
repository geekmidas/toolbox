import { PUBLIC_ENV_PREFIXES } from '../workspace/publicEnv.js';

/**
 * Set by a site's Dockerfile in its builder stage: this process is building
 * an image.
 *
 * Inside an image there is no stage to load secrets for and no local
 * container to resolve an address from — the public URLs the bundle inlines
 * arrived as the Dockerfile's build args, already in the environment. So
 * `gkm exec -- next build` there injects exactly those, and never the
 * `localhost` addresses a workspace resolves on a developer's machine.
 */
export const IMAGE_BUILD_ENV = 'GKM_IMAGE_BUILD';

/** Whether this process is building an image. */
export function isImageBuild(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[IMAGE_BUILD_ENV] === '1';
}

/**
 * Set by a site's Dockerfile in its builder stage: this build is offline —
 * no stage is reachable from it.
 *
 * A site's image is built before the stack it belongs to runs, so the APIs
 * its `.dependsOn()` names do not answer yet: data a page fetches while the
 * framework prerenders it would be none, cached as the page. A site tests
 * `process.env.GKM_BUILD_OFFLINE === '1'` to skip that fetch, and renders the
 * page on its first request instead — which gkm's warm-up after a deploy
 * makes before any visitor does.
 *
 * Separate from {@link IMAGE_BUILD_ENV}, which says what `gkm exec` injects:
 * this says what the build can reach. Only the builder stage sets it; the
 * running container never has it.
 */
export const BUILD_OFFLINE_ENV = 'GKM_BUILD_OFFLINE';

/** Whether this process is a build that no stage is reachable from. */
export function isOfflineBuild(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[BUILD_OFFLINE_ENV] === '1';
}

/**
 * What `gkm exec` injects inside an image build: the public values its build
 * args set — every `NEXT_PUBLIC_*`, `VITE_*` and `EXPO_PUBLIC_*` — and
 * nothing read from a secrets store, a file or a container.
 */
export function imageBuildCredentials(
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const credentials: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (PUBLIC_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
			credentials[key] = value;
		}
	}
	return credentials;
}
