import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStageSecrets } from '../generator';
import {
	deleteKey,
	generateKey,
	getKeyPath,
	getOrCreateKey,
	keyExists,
	requireKey,
} from '../keystore';
import { readStageSecrets, toEmbeddableSecrets } from '../storage';

describe('the key store', () => {
	let home: string;
	let project: string;
	let cwd: string;
	const originalHome = process.env.HOME;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), 'gkm-keys-home-'));
		project = mkdtempSync(join(tmpdir(), 'gkm-keys-project-'));
		cwd = process.cwd();
		process.env.HOME = home;
	});

	afterEach(() => {
		process.chdir(cwd);
		process.env.HOME = originalHome;
		rmSync(home, { recursive: true, force: true });
		rmSync(project, { recursive: true, force: true });
	});

	it("keeps a stage's key under ~/.gkm/<project>", async () => {
		const key = await generateKey('prod', 'shop');

		expect(getKeyPath('prod', 'shop')).toBe(
			join(home, '.gkm', 'shop', 'prod.key'),
		);
		expect(keyExists('prod', 'shop')).toBe(true);
		expect(await requireKey('prod', 'shop')).toBe(key);
	});

	it('names the project after the directory when none is given', async () => {
		process.chdir(project);

		await generateKey('dev');

		expect(keyExists('dev', basename(project))).toBe(true);
	});

	it('refuses to go on without a key, and says where it looked', async () => {
		process.chdir(project);

		await expect(requireKey('prod')).rejects.toThrow(
			`Encryption key not found for stage "prod" in project "${basename(project)}"`,
		);
	});

	it('deletes a key, and deleting a missing one is not an error', async () => {
		await generateKey('prod', 'shop');

		await deleteKey('prod', 'shop');
		await deleteKey('prod', 'shop');

		expect(keyExists('prod', 'shop')).toBe(false);
	});

	it('returns the existing key rather than replacing it', async () => {
		const first = await getOrCreateKey('prod', 'shop');
		const second = await getOrCreateKey('prod', 'shop');

		expect(second).toBe(first);
	});

	it('cannot read an encrypted stage whose key is gone', async () => {
		// Written encrypted, then the key removed: the file is unreadable, and
		// the error names where the key was expected.
		mkdirSync(join(project, '.gkm', 'secrets'), { recursive: true });
		writeFileSync(
			join(project, '.gkm', 'secrets', 'prod.json'),
			JSON.stringify({ version: 1, encrypted: 'x', iv: 'y' }),
		);

		await expect(readStageSecrets('prod', project)).rejects.toThrow(
			`Decryption key not found for stage "prod". Expected key at: ~/.gkm/${basename(project)}/prod.key`,
		);
		expect(existsSync(getKeyPath('prod', basename(project)))).toBe(false);
	});
});

describe('toEmbeddableSecrets, for every service', () => {
	it('flattens mail, the AWS emulator and pg-boss credentials too', () => {
		const secrets = createStageSecrets('dev', [
			'postgres',
			'mailpit',
			'localstack',
		]);

		const env = toEmbeddableSecrets(secrets);

		expect(env).toMatchObject({
			SMTP_HOST: secrets.services.mailpit!.host,
			SMTP_SECURE: 'false',
			MAIL_FROM: 'noreply@localhost',
			AWS_SECRET_ACCESS_KEY: secrets.services.localstack!.password,
			AWS_ENDPOINT_URL: `http://${secrets.services.localstack!.host}:${secrets.services.localstack!.port}`,
			PGBOSS_DB_USER: secrets.services.pgboss!.username,
		});
		expect(env.AWS_ACCESS_KEY_ID).toBe(
			secrets.services.localstack!.accessKeyId ??
				secrets.services.localstack!.username,
		);
	});

	it('falls back to defaults where a credential leaves a field out', () => {
		const secrets = createStageSecrets('dev', [
			'postgres',
			'minio',
			'localstack',
		]);
		delete secrets.services.postgres!.database;
		delete secrets.services.minio!.bucket;
		delete secrets.services.localstack!.region;
		delete secrets.services.localstack!.accessKeyId;

		expect(toEmbeddableSecrets(secrets)).toMatchObject({
			POSTGRES_DB: 'app',
			STORAGE_BUCKET: 'app',
			AWS_REGION: 'us-east-1',
			AWS_ACCESS_KEY_ID: secrets.services.localstack!.username,
		});
	});
});
