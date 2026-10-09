import { realpathSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { composeStageHosts, deploysWithCompose } from '../dns';

/**
 * What `gkm deploy --resources-only` reads off a compose stage before its
 * stack runs: the hosts the stack serves, from the stack itself.
 */

let dir: string;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-stage-hosts-'));
	writeComposeApp(dir, {
		target: 'compose',
		domain: 'shop.example.com',
		dns: { 'example.com': { provider: 'godaddy' } },
	});
});

afterAll(async () => {
	await cleanupDir(dir);
});

describe('composeStageHosts', () => {
	it('reads the hosts off the stack the stage would run: the apex and each app', async () => {
		const { workspace, manifest, runnables, background } =
			await loadComposeApp(dir);

		expect(deploysWithCompose(workspace)).toBe(true);
		await expect(
			composeStageHosts({
				workspace,
				stage: 'production',
				stored: null,
				manifest,
				runnables,
				background,
			}),
		).resolves.toEqual([
			'api.shop.example.com',
			'auth.shop.example.com',
			'shop.example.com',
		]);
	});
});
