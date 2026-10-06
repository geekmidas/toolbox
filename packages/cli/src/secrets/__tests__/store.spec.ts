import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { loadWorkspaceConfig } from '../../config';
import type { NormalizedWorkspace } from '../../workspace/types';
import { AwsSecretsStore, secretsParameterName } from '../aws';
import { createStageSecrets } from '../generator';
import { initStageSecrets } from '../storage';
import {
	FileSecretsStore,
	isRemoteStore,
	type SecretsStore,
	secretsStoreFor,
} from '../store';
import type { StageSecrets } from '../types';

/**
 * Against the AWS emulator (`docker compose up`, on `LOCALSTACK_HOST_PORT`). The store takes a
 * region like a real project's config; the SDK's standard endpoint variable
 * points it at the emulator.
 */
const EMULATOR = {
	AWS_ENDPOINT_URL: LOCALSTACK_URL,
	AWS_ACCESS_KEY_ID: 'test',
	AWS_SECRET_ACCESS_KEY: 'test',
};

const saved: Record<string, string | undefined> = {};
const originalHome = process.env.HOME;
let root: string;
let home: string;

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
	root = mkdtempSync(join(tmpdir(), 'gkm-store-'));
	home = mkdtempSync(join(tmpdir(), 'gkm-store-home-'));
	// Keys live under ~/.gkm; never the real one.
	process.env.HOME = home;
});

afterEach(() => {
	process.env.HOME = originalHome;
	rmSync(root, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
});

/** A unique project, so parameters from earlier runs never answer. */
const project = () => `store-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/** A workspace on disk, loaded the way every command loads one. */
async function workspace(store?: string): Promise<NormalizedWorkspace> {
	writeFileSync(
		join(root, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: '${project()}',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['staging', 'prod'] },
  secrets: {${store ? ` store: ${store}` : ''} },
});
`,
	);
	return (await loadWorkspaceConfig(root)).workspace;
}

/** A store holding what it is given, in memory. */
function memoryStore(): SecretsStore & { held: Map<string, StageSecrets> } {
	const held = new Map<string, StageSecrets>();
	return {
		name: 'memory',
		held,
		async read(stage) {
			return held.get(stage) ?? null;
		},
		async write(stage, secrets) {
			held.set(stage, secrets);
		},
	};
}

describe('FileSecretsStore', () => {
	it('keeps a stage encrypted under .gkm/secrets, and reads it back', async () => {
		const store = new FileSecretsStore(root);
		const secrets = createStageSecrets('prod', ['postgres']);

		await store.write('prod', secrets);

		expect(existsSync(store.path('prod'))).toBe(true);
		expect(await store.read('prod')).toEqual(secrets);
	});

	it('holds nothing for a stage never written', async () => {
		expect(await new FileSecretsStore(root).read('prod')).toBeNull();
	});
});

describe('secretsStoreFor', () => {
	it('uses the file when no store is configured', async () => {
		const ws = await workspace();

		expect(await secretsStoreFor(ws, 'prod')).toBeInstanceOf(FileSecretsStore);
		expect(isRemoteStore(ws, 'prod')).toBe(false);
	});

	it('keeps the local stage in the file whatever the store', async () => {
		const ws = await workspace("{ provider: 'ssm', region: 'us-east-1' }");

		expect(await secretsStoreFor(ws, 'dev')).toBeInstanceOf(FileSecretsStore);
		expect(isRemoteStore(ws, 'dev')).toBe(false);
		expect(isRemoteStore(ws, 'prod')).toBe(true);
	});

	it('uses SSM for a deployed stage when configured', async () => {
		const ws = await workspace("{ provider: 'ssm', region: 'us-east-1' }");

		expect(await secretsStoreFor(ws, 'prod')).toBeInstanceOf(AwsSecretsStore);
	});

	it('uses a custom store as given', async () => {
		const custom = memoryStore();
		const ws = {
			...(await workspace()),
		} as NormalizedWorkspace;
		ws.secrets = { store: { provider: custom } };

		expect(await secretsStoreFor(ws, 'prod')).toBe(custom);
	});

	it('refuses a store that is not one', async () => {
		await expect(
			workspace('{ provider: { read() {} } } as never'),
		).rejects.toThrow('Workspace configuration validation failed');
		// The old shape is not one any more either.
		await expect(
			workspace('{ provider: { pull() {}, push() {} } } as never'),
		).rejects.toThrow('Workspace configuration validation failed');
	});

	it('accepts a custom store with a name, read() and write()', async () => {
		const ws = await workspace(
			"{ provider: { name: 'vault', async read() { return null; }, async write() {} } }",
		);

		expect((await secretsStoreFor(ws, 'prod')).name).toBe('vault');
	});
});

describe('AwsSecretsStore', () => {
	it('keeps a stage in one SecureString, and reads it back', async () => {
		const name = project();
		const store = new AwsSecretsStore({ project: name, region: 'us-east-1' });
		const secrets = createStageSecrets('prod', ['postgres']);
		secrets.custom = { STRIPE_KEY: 'sk_live_1' };

		await store.write('prod', secrets);

		expect(await store.read('prod')).toEqual(secrets);
		const { Parameter } = await new SSMClient({ region: 'us-east-1' }).send(
			new GetParameterCommand({ Name: secretsParameterName(name, 'prod') }),
		);
		expect(Parameter?.Type).toBe('SecureString');
	});

	it('overwrites a stage on a second write', async () => {
		const store = new AwsSecretsStore({
			project: project(),
			region: 'us-east-1',
		});
		const first = initStageSecrets('prod');
		const second = { ...first, custom: { ROTATED: 'yes' } };

		await store.write('prod', first);
		await store.write('prod', second);

		expect(await store.read('prod')).toEqual(second);
	});

	it('holds nothing for a stage never written', async () => {
		const store = new AwsSecretsStore({
			project: project(),
			region: 'us-east-1',
		});

		expect(await store.read('prod')).toBeNull();
	});

	it('reaches the endpoint it is given', async () => {
		delete process.env.AWS_ENDPOINT_URL;

		try {
			const store = new AwsSecretsStore({
				project: project(),
				region: 'us-east-1',
				endpoint: EMULATOR.AWS_ENDPOINT_URL,
			});
			const secrets = initStageSecrets('prod');

			await store.write('prod', secrets);

			expect(await store.read('prod')).toEqual(secrets);
		} finally {
			process.env.AWS_ENDPOINT_URL = EMULATOR.AWS_ENDPOINT_URL;
		}
	});

	it('names the parameter by project and stage', () => {
		expect(secretsParameterName('shop', 'prod')).toBe('/gkm/shop/prod/secrets');
	});

	it('resolves a named profile from the profile, never from AWS_* env', async () => {
		const credentials = join(home, 'credentials');
		writeFileSync(
			credentials,
			'[acme-prod]\naws_access_key_id = LSIAPRODKEY\naws_secret_access_key = prod-secret\n',
		);
		writeFileSync(join(home, 'config'), '');
		const previous = {
			AWS_SHARED_CREDENTIALS_FILE: process.env.AWS_SHARED_CREDENTIALS_FILE,
			AWS_CONFIG_FILE: process.env.AWS_CONFIG_FILE,
		};
		process.env.AWS_SHARED_CREDENTIALS_FILE = credentials;
		process.env.AWS_CONFIG_FILE = join(home, 'config');
		// Exported keys for another account, which must not win.
		process.env.AWS_ACCESS_KEY_ID = 'LSIASTAGINGKEY';

		try {
			const store = new AwsSecretsStore({
				project: 'shop',
				region: 'us-east-1',
				profile: 'acme-prod',
			});
			const client = await (
				store as unknown as { ssm(): Promise<SSMClient> }
			).ssm();
			const resolved = await client.config.credentials();

			expect(resolved.accessKeyId).toBe('LSIAPRODKEY');
		} finally {
			process.env.AWS_ACCESS_KEY_ID = EMULATOR.AWS_ACCESS_KEY_ID;
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
});

describe('secretsStoreFor, read and written', () => {
	it('reads a deployed stage from its store, not from a local copy', async () => {
		const custom = memoryStore();
		custom.held.set('prod', {
			...initStageSecrets('prod'),
			custom: { STRIPE_KEY: 'sk_from_store' },
		});
		const ws = await workspace();
		ws.secrets = { store: { provider: custom } };
		// A stale copy on this machine, which must not answer.
		await new FileSecretsStore(root).write('prod', {
			...initStageSecrets('prod'),
			custom: { STRIPE_KEY: 'sk_stale' },
		});

		const store = await secretsStoreFor(ws, 'prod');

		expect((await store.read('prod'))?.custom).toEqual({
			STRIPE_KEY: 'sk_from_store',
		});
	});

	it('writes a deployed stage straight to its store, with no push', async () => {
		const custom = memoryStore();
		const ws = await workspace();
		ws.secrets = { store: { provider: custom } };

		const store = await secretsStoreFor(ws, 'prod');
		await store.write('prod', {
			...initStageSecrets('prod'),
			custom: { STRIPE_KEY: 'sk_1' },
		});

		expect(custom.held.get('prod')?.custom).toEqual({ STRIPE_KEY: 'sk_1' });
		expect(existsSync(new FileSecretsStore(root).path('prod'))).toBe(false);
	});

	it('keeps a deployed stage in SSM when configured, with no local file', async () => {
		const ws = await workspace("{ provider: 'ssm', region: 'us-east-1' }");

		const store = await secretsStoreFor(ws, 'prod');
		await store.write('prod', {
			...initStageSecrets('prod'),
			custom: { STRIPE_KEY: 'sk_ssm' },
		});

		expect(existsSync(new FileSecretsStore(root).path('prod'))).toBe(false);
		const again = await secretsStoreFor(ws, 'prod');
		expect((await again.read('prod'))?.custom).toEqual({
			STRIPE_KEY: 'sk_ssm',
		});
	});

	it('keeps the local stage in the file, whatever the store', async () => {
		const ws = await workspace("{ provider: 'ssm', region: 'us-east-1' }");

		const store = await secretsStoreFor(ws, 'dev');
		await store.write('dev', initStageSecrets('dev'));

		expect(existsSync(new FileSecretsStore(root).path('dev'))).toBe(true);
	});
});
