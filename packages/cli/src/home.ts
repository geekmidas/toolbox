/**
 * Where the CLI keeps what belongs to a person rather than a project: stage
 * keys and stored provider credentials.
 *
 * `GKM_HOME` names it, so a CI job, a shared build runner or a test can give
 * every run its own instead of reaching into whoever's home directory the
 * process happens to have. Unset, it is `~/.gkm`, where it has always been.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** The environment variable that moves the CLI's home. */
export const GKM_HOME_ENV = 'GKM_HOME';

/** The CLI's home: `GKM_HOME` if set, else `~/.gkm`. */
export function gkmHome(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env[GKM_HOME_ENV];
	return configured ? resolve(configured) : join(homedir(), '.gkm');
}
