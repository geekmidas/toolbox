import {
	chmodSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import {
	ANDROID_PUBLISHER_SCOPE,
	CLOUD_PLATFORM_SCOPE,
	GoogleSignInRequired,
	gcloudConfig,
	gcloudSignIn,
} from '../gcloud';

/**
 * Signing in through gcloud: a stand-in `gcloud` on PATH that records how it
 * was run, and answers a token only once it has been logged in.
 */

let dir: string;
let log: string;

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-gcloud-'));
	log = join(dir, 'gcloud.txt');
	const bin = join(dir, 'bin');
	mkdirSync(bin);
	writeFileSync(
		join(bin, 'gcloud'),
		`#!/bin/sh
echo "$CLOUDSDK_CONFIG $*" >> '${log}'
case "$3" in
  login) touch '${join(dir, 'signed-in')}' ;;
  print-access-token)
    [ -f '${join(dir, 'signed-in')}' ] || exit 1
    echo ya29.person ;;
esac
`,
	);
	chmodSync(join(bin, 'gcloud'), 0o755);
	vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH}`);
	vi.stubEnv('GKM_HOME', join(dir, '.gkm'));
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await cleanupDir(dir);
});

function runs(): string[] {
	return readFileSync(log, 'utf8').trim().split('\n');
}

describe("gcloud's sign-in, in gkm's own config", () => {
	it('signs in with the scopes asked for, then answers the token', async () => {
		const config = gcloudConfig();

		const token = await gcloudSignIn(config).token({ interactive: true });

		expect(token).toBe('ya29.person');
		expect(config).toBe(join(dir, '.gkm', 'gcloud'));
		expect(runs()).toEqual([
			`${config} auth application-default print-access-token`,
			`${config} auth application-default login --scopes=${CLOUD_PLATFORM_SCOPE}`,
			`${config} auth application-default print-access-token`,
		]);
	});

	it('signs in again, for every scope so far, when one is missing', async () => {
		const config = gcloudConfig();
		const signIn = gcloudSignIn(config);
		await signIn.token({ interactive: true });

		await signIn.token({
			interactive: true,
			scopes: [CLOUD_PLATFORM_SCOPE, ANDROID_PUBLISHER_SCOPE],
		});

		expect(runs().slice(3)).toEqual([
			`${config} auth application-default login --scopes=${CLOUD_PLATFORM_SCOPE},${ANDROID_PUBLISHER_SCOPE}`,
			`${config} auth application-default print-access-token`,
		]);
	});

	it('reuses a sign-in that already has the scopes', async () => {
		const config = gcloudConfig();
		const signIn = gcloudSignIn(config);
		await signIn.token({
			interactive: true,
			scopes: [CLOUD_PLATFORM_SCOPE, ANDROID_PUBLISHER_SCOPE],
		});

		await signIn.token({ interactive: false });

		expect(runs().slice(3)).toEqual([
			`${config} auth application-default print-access-token`,
		]);
	});

	it('never opens a browser with nobody to use it', async () => {
		await expect(
			gcloudSignIn(gcloudConfig()).token({ interactive: false }),
		).rejects.toThrow(GoogleSignInRequired);
		expect(readFileSync(log, 'utf8')).not.toContain('login');
	});
});
