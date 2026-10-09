import { realpathSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { deploysWithCompose } from '../dns';

/** Whether the deploy's DNS step applies: the workspace deploys with compose. */

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

describe('deploysWithCompose', () => {
	it('is true for a workspace whose default target is compose', async () => {
		const { workspace } = await loadComposeApp(dir);
		expect(deploysWithCompose(workspace)).toBe(true);
	});
});
