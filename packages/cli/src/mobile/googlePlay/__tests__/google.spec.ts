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
import { GoogleSignInRequired, gcloudConfig, gcloudSignIn } from '../google';

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

describe("gcloud's sign-in, in gkm's own config", () => {
	it('signs in with both scopes when asked, then answers the token', async () => {
		const config = gcloudConfig();

		const token = await gcloudSignIn(config).token({ interactive: true });

		expect(token).toBe('ya29.person');
		expect(config).toBe(join(dir, '.gkm', 'gcloud'));
		const runs = readFileSync(log, 'utf8').trim().split('\n');
		expect(runs).toEqual([
			`${config} auth application-default print-access-token`,
			`${config} auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/androidpublisher`,
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
