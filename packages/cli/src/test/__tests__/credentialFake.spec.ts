import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestManifest } from '@geekmidas/constructs/testing';
import { featureTest } from '@geekmidas/constructs/testing';
import { afterAll, describe, expect, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { CredentialHasNoTestValue } from '../../reconcile/fakes';
import { testCommand } from '../index';

/**
 * A `Credential` on a test stage set up fresh — CI's auto-setup, which stores
 * no third party's values. With a fake at `test/fakes/<id>.ts` the suite is
 * handed it, and a feature test resolves the credential's service; without
 * one, `gkm test` stops before any test runs, naming the key and the fake to
 * add.
 */

const CONSTRUCT = `import { Credential } from '@geekmidas/constructs/credential';
import { z } from 'zod';

export const reviewerPassword = new Credential('ReviewerPassword', {
  schema: z.string().min(16),
});
`;

const FAKE = `import { fake } from '@geekmidas/constructs/credential';

export default fake.credential('a-reviewer-password-for-tests');
`;

/** A workspace declaring the credential — with its fake, or without. */
async function workspace(withFake: boolean): Promise<string> {
	const dir = realpathSync(await createTempDir('gkm-credential-fake-'));
	writeFileSync(
		join(dir, 'gkm.config.ts'),
		`export default {
  name: 'reviews',
  stages: { local: 'dev', deployed: ['prod'] },
  constructs: './src/constructs/**/*.ts',
};
`,
	);
	mkdirSync(join(dir, 'src', 'constructs'), { recursive: true });
	writeFileSync(join(dir, 'src', 'constructs', 'reviewer.ts'), CONSTRUCT);
	if (withFake) {
		mkdirSync(join(dir, 'test', 'fakes'), { recursive: true });
		writeFileSync(join(dir, 'test', 'fakes', 'reviewer-password.ts'), FAKE);
	}
	return dir;
}

/** `gkm test --prepare` in `dir`, as CI runs it: auto-setup, nothing stored. */
async function prepare(dir: string): Promise<void> {
	const cwd = process.cwd();
	process.chdir(dir);
	vi.stubEnv('HOME', dir);
	vi.stubEnv('GKM_HOME', join(dir, '.gkm-home'));
	vi.stubEnv('GKM_AUTO_SETUP', '1');
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	try {
		await testCommand({ prepare: true });
	} finally {
		log.mockRestore();
		vi.unstubAllEnvs();
		process.chdir(cwd);
	}
}

const faked = await workspace(true);
await prepare(faked);

const manifest = JSON.parse(
	readFileSync(join(faked, '.gkm', 'test', 'manifest.json'), 'utf-8'),
) as TestManifest;
const source = manifest.constructs.ReviewerPassword!.source.file;

const it = featureTest<
	import('@geekmidas/testkit/browser').Browser,
	{},
	{},
	{ reviewerPassword: string }
>({ manifest, modules: { [source]: await import(source) } });

afterAll(() => cleanupDir(faked));

describe('a credential on a fresh test stage', { timeout: 60_000 }, () => {
	it('resolves to its fake in a feature test', async ({ services }) => {
		expect(await services.get('reviewerPassword')).toBe(
			'a-reviewer-password-for-tests',
		);
	});

	it('is in the environment gkm test hands the suite', () => {
		expect(manifest.env.REVIEWER_PASSWORD_CREDENTIALS).toBe(
			'"a-reviewer-password-for-tests"',
		);
	});

	it('without a fake, stops gkm test with the key and the fake to add', async () => {
		const bare = await workspace(false);
		try {
			const error = await prepare(bare).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(CredentialHasNoTestValue);
			expect(error).toMatchObject({
				id: 'ReviewerPassword',
				key: 'REVIEWER_PASSWORD_CREDENTIALS',
				file: join(bare, 'test', 'fakes', 'reviewer-password.ts'),
			});
			expect((error as Error).message).toContain('fake.credential(…)');
		} finally {
			await cleanupDir(bare);
		}
	});
});
