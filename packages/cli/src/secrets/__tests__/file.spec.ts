import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSecretsStore, MissingSecretsKey } from '../file';
import { getKeyPath, projectKey } from '../keystore';
import type { StageSecrets } from '../types';

describe('FileSecretsStore', () => {
	const originalHome = process.env.HOME;
	let root: string;
	let home: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-file-store-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-file-store-home-'));
		// Keys live under ~/.gkm; never the real one.
		process.env.HOME = home;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('keeps a stage at .gkm/secrets/<stage>.json', () => {
		expect(new FileSecretsStore('/project').path('dev-local')).toBe(
			'/project/.gkm/secrets/dev-local.json',
		);
	});

	it('writes a stage encrypted, and reads it back', async () => {
		const store = new FileSecretsStore(root);
		const secrets: StageSecrets = {
			stage: 'production',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
			services: {
				postgres: {
					host: 'postgres',
					port: 5432,
					username: 'app',
					password: 'secret123',
					database: 'app',
				},
			},
			urls: {
				DATABASE_URL: 'postgresql://app:secret123@postgres:5432/app',
			},
			custom: { API_KEY: 'sk_test_123' },
		};

		await store.write('production', secrets);

		expect(await store.read('production')).toEqual(secrets);
		// Encrypted on disk: not a password in sight.
		const onDisk = readFileSync(store.path('production'), 'utf-8');
		expect(onDisk).not.toContain('secret123');
		expect(JSON.parse(onDisk)).toMatchObject({ version: 1 });
	});

	it('creates the secrets directory when it does not exist', async () => {
		const store = new FileSecretsStore(root);

		await store.write('staging', {
			stage: 'staging',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			services: {},
			urls: {},
			custom: {},
		});

		expect(existsSync(join(root, '.gkm/secrets'))).toBe(true);
		expect(existsSync(store.path('staging'))).toBe(true);
		// Outside a workspace the project is named the way a workspace without
		// a name is: by its folder, here.
		expect(
			existsSync(
				getKeyPath('staging', { key: projectKey({ name: basename(root) }) }),
			),
		).toBe(true);
	});

	it('holds nothing for a stage never written', async () => {
		expect(await new FileSecretsStore(root).read('nonexistent')).toBeNull();
	});

	it('cannot read an encrypted stage whose key is gone', async () => {
		mkdirSync(join(root, '.gkm', 'secrets'), { recursive: true });
		writeFileSync(
			join(root, '.gkm', 'secrets', 'prod.json'),
			JSON.stringify({ version: 1, encrypted: 'x', iv: 'y' }),
		);

		const error = await new FileSecretsStore(root)
			.read('prod')
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(MissingSecretsKey);
		const project = { key: projectKey({ name: basename(root) }) };
		expect(error).toMatchObject({
			stage: 'prod',
			project: project.key,
			path: getKeyPath('prod', project),
		});
	});
});
