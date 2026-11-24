/**
 * Signing in to Google on a person's machine: gcloud's own
 * application-default credential — no OAuth client of gkm's — kept in gkm's
 * own gcloud config (`<gkm home>/gcloud`), so the person's own gcloud setup
 * is never read or changed.
 *
 * A user credential carries the scopes it was signed in with, fixed until
 * the next sign-in. gkm writes them beside it (`gkm-scopes.json`), and a
 * caller that asks for a scope the sign-in lacks signs in again, for every
 * scope asked for so far — so the Play setup and Maps share one sign-in.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GkmError } from '../../errors';
import { gkmHome } from '../../home.js';

/** What every Google Cloud API accepts. */
export const CLOUD_PLATFORM_SCOPE =
	'https://www.googleapis.com/auth/cloud-platform';

/** The Play Developer API's own scope. */
export const ANDROID_PUBLISHER_SCOPE =
	'https://www.googleapis.com/auth/androidpublisher';

/** `gcloud` is not installed. */
export class GcloudMissing extends GkmError {
	constructor() {
		super(
			'gkm signs in to Google with gcloud, and there is no `gcloud` here. ' +
				'Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install.',
		);
		this.name = 'GcloudMissing';
	}
}

/** Not signed in (or not for these scopes), and no terminal to sign in from. */
export class GoogleSignInRequired extends GkmError {
	constructor(
		readonly config: string,
		readonly scopes: readonly string[],
	) {
		super(
			'Signing in to Google opens a browser, and this run has no terminal. ' +
				'Run it once where you can sign in: ' +
				`CLOUDSDK_CONFIG=${config} gcloud auth application-default login ` +
				`--scopes=${scopes.join(',')}. ` +
				'In CI, authenticate with google-github-actions/auth, which sets ' +
				'GOOGLE_APPLICATION_CREDENTIALS (gkm deploy:github sets it up).',
		);
		this.name = 'GoogleSignInRequired';
	}
}

/** Where gkm keeps its gcloud sign-in. */
export function gcloudConfig(env: NodeJS.ProcessEnv = process.env): string {
	return join(gkmHome(env), 'gcloud');
}

/** How a token is had. */
export interface GoogleSignIn {
	/**
	 * An access token carrying `scopes` (default: cloud-platform), signing in
	 * when `interactive` allows it.
	 */
	token(options: {
		interactive: boolean;
		scopes?: readonly string[];
	}): Promise<string>;
}

function gcloud(
	args: readonly string[],
	config: string,
	inherit: boolean,
): Promise<{ code: number | null; stdout: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn('gcloud', [...args], {
			stdio: [
				'inherit',
				inherit ? 'inherit' : 'pipe',
				inherit ? 'inherit' : 'pipe',
			],
			env: { ...process.env, CLOUDSDK_CONFIG: config },
		});
		let stdout = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.on('error', (error: NodeJS.ErrnoException) =>
			reject(error.code === 'ENOENT' ? new GcloudMissing() : error),
		);
		child.on('close', (code) => resolve({ code, stdout }));
	});
}

/** The scopes gkm recorded for the sign-in in `config`, if it did. */
function recordedScopes(config: string): string[] | undefined {
	const file = join(config, 'gkm-scopes.json');
	if (!existsSync(file)) return undefined;
	try {
		const scopes = JSON.parse(readFileSync(file, 'utf8')) as unknown;
		return Array.isArray(scopes) ? scopes.map(String) : [];
	} catch {
		return [];
	}
}

/** gcloud's application-default credential, in gkm's own gcloud config. */
export function gcloudSignIn(config: string = gcloudConfig()): GoogleSignIn {
	return {
		async token({ interactive, scopes = [CLOUD_PLATFORM_SCOPE] }) {
			const print = () =>
				gcloud(
					['auth', 'application-default', 'print-access-token'],
					config,
					false,
				);
			const recorded = recordedScopes(config);
			const covers = (had: readonly string[]) =>
				scopes.every((scope) => had.includes(scope));
			let printed =
				recorded === undefined || covers(recorded) ? await print() : undefined;
			// A sign-in from before gkm recorded scopes was the Play setup's,
			// which asked for both.
			const had =
				recorded ??
				(printed?.code === 0
					? [CLOUD_PLATFORM_SCOPE, ANDROID_PUBLISHER_SCOPE]
					: []);
			if (!printed || printed.code !== 0 || !covers(had)) {
				const wanted = [...new Set([...had, ...scopes])];
				if (!interactive) throw new GoogleSignInRequired(config, wanted);
				await gcloud(
					[
						'auth',
						'application-default',
						'login',
						`--scopes=${wanted.join(',')}`,
					],
					config,
					true,
				);
				printed = await print();
				if (printed.code !== 0) throw new GoogleSignInRequired(config, wanted);
				mkdirSync(config, { recursive: true });
				writeFileSync(
					join(config, 'gkm-scopes.json'),
					`${JSON.stringify(wanted)}\n`,
				);
			}
			return printed.stdout.trim();
		},
	};
}
