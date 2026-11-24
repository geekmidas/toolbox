import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import { googleProvisioningCredentials } from '../provisioning';

/**
 * Whether a deploy has Google credentials to provision with. An empty PATH
 * stands for a machine without gcloud.
 */

let dir: string;

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-google-prov-'));
	mkdirSync(join(dir, 'empty-bin'));
});

afterEach(async () => {
	await cleanupDir(dir);
});

describe("a Google provider's provisioning credentials", () => {
	it('are the credentials file when one is set, with --project', async () => {
		const credential = await googleProvisioningCredentials(
			{
				stage: 'prod',
				project: 'acme-prod',
				env: { GOOGLE_APPLICATION_CREDENTIALS: join(dir, 'gha.json') },
			},
			{ interactive: false },
		);

		expect(credential).toMatchObject({
			source: 'file',
			interactive: false,
			project: 'acme-prod',
		});
	});

	it('are gcloud at a terminal, which signs in when it has to', async () => {
		const credential = await googleProvisioningCredentials(
			{ stage: 'prod', env: {}, home: dir },
			{ interactive: true },
		);

		expect(credential).toMatchObject({ source: 'gcloud', interactive: true });
	});

	it('are none with no file, no terminal and no gcloud sign-in', async () => {
		const original = process.env.PATH;
		process.env.PATH = join(dir, 'empty-bin');
		try {
			const credential = await googleProvisioningCredentials(
				{ stage: 'prod', env: {}, home: dir },
				{ interactive: false },
			);

			expect(credential).toBeUndefined();
		} finally {
			process.env.PATH = original;
		}
	});
});
