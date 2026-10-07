import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSecretsStore, MissingSecretsKey } from '../file';
import { createStageSecrets } from '../generator';
import {
	deleteKey,
	generateKey,
	getKeyPath,
	getOrCreateKey,
	KeyNotFound,
	type KeystoreProject,
	KeystoreProjectInvalid,
	keyExists,
	keystoreProject,
	readKey,
	requireKey,
} from '../keystore';
import { toEmbeddableSecrets } from '../storage';

describe('the key store', () => {
	let home: string;
	let project: string;
	const shop: KeystoreProject = { key: 'shop/shop' };

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), 'gkm-keys-home-'));
		project = mkdtempSync(join(tmpdir(), 'gkm-keys-project-'));
		vi.stubEnv('HOME', home);
		vi.stubEnv('GKM_HOME', undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
		rmSync(project, { recursive: true, force: true });
	});

	/** A key where every CLI before identities wrote it: `~/.gkm/<folder>`. */
	const legacyKey = (folder: string, stage: string, key: string) => {
		mkdirSync(join(home, '.gkm', folder), { recursive: true });
		writeFileSync(join(home, '.gkm', folder, `${stage}.key`), `${key}\n`, {
			mode: 0o600,
		});
		return join(home, '.gkm', folder, `${stage}.key`);
	};

	it("keeps a stage's key under ~/.gkm/keys/<namespace>/<project>", async () => {
		const key = await generateKey('prod', shop);

		expect(getKeyPath('prod', shop)).toBe(
			join(home, '.gkm', 'keys', 'shop', 'shop', 'prod.key'),
		);
		expect(statSync(getKeyPath('prod', shop)).mode & 0o777).toBe(0o600);
		expect(keyExists('prod', shop)).toBe(true);
		expect(await requireKey('prod', shop)).toBe(key);
	});

	it('keeps keys wherever GKM_HOME says', async () => {
		const elsewhere = join(home, 'runner-home');
		vi.stubEnv('GKM_HOME', elsewhere);

		await generateKey('prod', shop);

		expect(
			existsSync(join(elsewhere, 'keys', 'shop', 'shop', 'prod.key')),
		).toBe(true);
		expect(existsSync(join(home, '.gkm'))).toBe(false);
		// And an explicit home wins over the variable.
		const explicit = join(home, 'explicit');
		await generateKey('prod', { ...shop, home: explicit });
		expect(existsSync(join(explicit, 'keys', 'shop', 'shop', 'prod.key'))).toBe(
			true,
		);
	});

	it('keeps two projects in folders with the same name apart', async () => {
		// ~/work/api and ~/oss/api: one folder name, two workspaces.
		const work = join(project, 'work', 'api');
		const oss = join(project, 'oss', 'api');
		for (const [dir, name] of [
			[work, 'billing'],
			[oss, 'storefront'],
		] as const) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
		}

		const secrets = createStageSecrets('prod', []);
		await new FileSecretsStore(
			work,
			keystoreProject({ name: 'billing', root: work }),
		).write('prod', { ...secrets, custom: { WHO: 'billing' } });
		await new FileSecretsStore(
			oss,
			keystoreProject({ name: 'storefront', root: oss }),
		).write('prod', { ...secrets, custom: { WHO: 'storefront' } });

		const billing = await readKey('prod', { key: 'billing/billing' });
		const storefront = await readKey('prod', { key: 'storefront/storefront' });
		expect(billing).not.toBeNull();
		expect(storefront).not.toBeNull();
		expect(billing).not.toBe(storefront);
		// Each still opens its own file — the second did not replace the first.
		expect((await new FileSecretsStore(work).read('prod'))?.custom).toEqual({
			WHO: 'billing',
		});
		expect((await new FileSecretsStore(oss).read('prod'))?.custom).toEqual({
			WHO: 'storefront',
		});
	});

	it('copies a key from ~/.gkm/<folder> on first read, and keeps the old one', async () => {
		const old = legacyKey('my-checkout', 'prod', 'a1b2c3');
		const location = { key: 'shop/shop', legacy: ['my-checkout'] };

		expect(keyExists('prod', location)).toBe(true);
		expect(await readKey('prod', location)).toBe('a1b2c3');

		const copied = getKeyPath('prod', location);
		expect(readFileSync(copied, 'utf8').trim()).toBe('a1b2c3');
		expect(statSync(copied).mode & 0o777).toBe(0o600);
		// An older CLI on this machine still reads the old place.
		expect(readFileSync(old, 'utf8').trim()).toBe('a1b2c3');

		// Once copied, the new place is the one read.
		writeFileSync(old, 'changed-under-the-old-cli');
		expect(await readKey('prod', location)).toBe('a1b2c3');
	});

	it('finds a key under ~/.gkm/<folder> when GKM_HOME moved the home', async () => {
		legacyKey('my-checkout', 'prod', 'a1b2c3');
		vi.stubEnv('GKM_HOME', join(home, 'moved'));

		const location = { key: 'shop/shop', legacy: ['my-checkout'] };

		expect(await readKey('prod', location)).toBe('a1b2c3');
		expect(
			existsSync(join(home, 'moved', 'keys', 'shop', 'shop', 'prod.key')),
		).toBe(true);
	});

	it('finds a key `gkm init` or its CI workflow wrote under the workspace name', async () => {
		legacyKey('shop', 'prod', 'from-ci');

		const read = await readKey(
			'prod',
			keystoreProject({ name: 'shop', root: join(project, 'checkout') }),
		);

		expect(read).toBe('from-ci');
	});

	it("opens a secrets file written under the folder's name, transparently", async () => {
		// Written by the CLI before identities: key at ~/.gkm/<folder>.
		const before = new FileSecretsStore(project, {
			key: 'shop/shop',
			legacy: [basename(project)],
		});
		await before.write('prod', createStageSecrets('prod', []));
		const key = readFileSync(getKeyPath('prod', { key: 'shop/shop' }), 'utf8');
		rmSync(join(home, '.gkm', 'keys'), { recursive: true });
		legacyKey(basename(project), 'prod', key);

		const read = await new FileSecretsStore(
			project,
			keystoreProject({ name: 'shop', root: project }),
		).read('prod');

		expect(read?.stage).toBe('prod');
	});

	it('takes the default namespace key along when a namespace is set', async () => {
		const key = await generateKey('prod', { key: 'shop/shop' });
		const scoped = keystoreProject({
			name: 'shop',
			root: project,
			deploy: { namespace: 'acme' },
		});

		expect(scoped.key).toBe('acme/shop');
		expect(await readKey('prod', scoped)).toBe(key);
		expect(existsSync(getKeyPath('prod', scoped))).toBe(true);
	});

	it('refuses to go on without a key, and says where it looked', async () => {
		await expect(requireKey('prod', shop)).rejects.toBeInstanceOf(KeyNotFound);
		await expect(requireKey('prod', shop)).rejects.toThrow(
			`Expected key at: ${join(home, '.gkm', 'keys', 'shop', 'shop', 'prod.key')}`,
		);
	});

	it('refuses a project key that could leave the keystore', () => {
		expect(() => getKeyPath('prod', { key: '../../etc' })).toThrow(
			KeystoreProjectInvalid,
		);
	});

	it('deletes a key, and deleting a missing one is not an error', async () => {
		await generateKey('prod', shop);

		await deleteKey('prod', shop);
		await deleteKey('prod', shop);

		expect(keyExists('prod', shop)).toBe(false);
	});

	it('returns the existing key rather than replacing it', async () => {
		const first = await getOrCreateKey('prod', shop);
		const second = await getOrCreateKey('prod', shop);

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

		const reading = new FileSecretsStore(project, shop).read('prod');

		await expect(reading).rejects.toBeInstanceOf(MissingSecretsKey);
		await expect(reading).rejects.toThrow(
			`Expected key at: ${getKeyPath('prod', shop)}`,
		);
		expect(existsSync(getKeyPath('prod', shop))).toBe(false);
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
