import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCredentialsPreload } from '../../dev/index';

describe('test credentials preload', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `gkm-pipeline-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('should write test-secrets.json and credentials preload', async () => {
		const gkmDir = join(testDir, '.gkm');
		mkdirSync(gkmDir, { recursive: true });

		const secrets = {
			DATABASE_URL: 'postgresql://app:secret@localhost:5433/myapp_test',
			JWT_SECRET: 'test-jwt-secret',
		};

		const secretsJsonPath = join(gkmDir, 'test-secrets.json');
		writeFileSync(secretsJsonPath, JSON.stringify(secrets, null, 2));

		const preloadPath = join(gkmDir, 'test-credentials-preload.ts');
		await createCredentialsPreload(preloadPath, secretsJsonPath);

		// Verify secrets JSON was written
		expect(existsSync(secretsJsonPath)).toBe(true);
		const written = JSON.parse(readFileSync(secretsJsonPath, 'utf-8'));
		expect(written.DATABASE_URL).toBe(secrets.DATABASE_URL);
		expect(written.JWT_SECRET).toBe(secrets.JWT_SECRET);

		// Verify preload script was created with correct content
		expect(existsSync(preloadPath)).toBe(true);
		const preloadContent = readFileSync(preloadPath, 'utf-8');
		expect(preloadContent).toContain('__gkm_credentials__');
		expect(preloadContent).toContain('Object.assign(process.env');
		expect(preloadContent).toContain(secretsJsonPath);
	});
});
