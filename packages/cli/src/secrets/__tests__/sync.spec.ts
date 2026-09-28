import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { createStageSecrets } from '../generator';
import { writeStageSecrets } from '../storage';
import { isSSMConfigured, pullSecrets, pushSecrets } from '../sync';

/**
 * Against the AWS emulator on 4566 (`docker compose up`), reached through
 * the SDK's standard endpoint variable — the sync module takes a region and
 * a profile, like a real project's config, and nothing test-shaped.
 */
const EMULATOR = {
	AWS_ENDPOINT_URL: 'http://localhost:4566',
	AWS_ACCESS_KEY_ID: 'test',
	AWS_SECRET_ACCESS_KEY: 'test',
};

describe('secrets sync through SSM', () => {
	const saved: Record<string, string | undefined> = {};
	let root: string;
	let home: string;
	const originalHome = process.env.HOME;

	beforeAll(() => {
		for (const [key, value] of Object.entries(EMULATOR)) {
			saved[key] = process.env[key];
			process.env[key] = value;
		}
	});

	afterAll(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-sync-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-sync-home-'));
		process.env.HOME = home;
		return () => {
			process.env.HOME = originalHome;
			rmSync(root, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		};
	});

	const workspace = (overrides: Partial<NormalizedWorkspace> = {}) =>
		({
			name: `sync-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
			root,
			state: { provider: 'ssm', region: 'us-east-1' },
			...overrides,
		}) as NormalizedWorkspace;

	it('pushes a stage and pulls the same secrets back', async () => {
		const ws = workspace();
		const secrets = createStageSecrets('prod', ['postgres']);
		secrets.custom = { STRIPE_KEY: 'sk_live_1' };
		await writeStageSecrets(secrets, root);

		await pushSecrets('prod', ws);
		const pulled = await pullSecrets('prod', ws);

		expect(pulled).toEqual(secrets);
	});

	it('pulls nothing for a stage never pushed', async () => {
		expect(await pullSecrets('never-pushed', workspace())).toBeNull();
	});

	it('pulls nothing without SSM or a workspace name', async () => {
		expect(
			await pullSecrets('prod', workspace({ state: undefined })),
		).toBeNull();
		expect(
			await pullSecrets(
				'prod',
				workspace({ state: { provider: 'local' } as never }),
			),
		).toBeNull();
		expect(await pullSecrets('prod', workspace({ name: '' }))).toBeNull();
	});

	it('refuses to push without SSM, a name, or local secrets', async () => {
		await expect(
			pushSecrets('prod', workspace({ state: undefined })),
		).rejects.toThrow('SSM state provider not configured');
		await expect(pushSecrets('prod', workspace({ name: '' }))).rejects.toThrow(
			'Workspace name is required',
		);
		await expect(pushSecrets('prod', workspace())).rejects.toThrow(
			'No secrets found for stage "prod"',
		);
	});

	it('knows whether SSM is configured', () => {
		expect(isSSMConfigured(workspace())).toBe(true);
		expect(isSSMConfigured(workspace({ state: undefined }))).toBe(false);
	});
});
