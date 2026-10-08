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
