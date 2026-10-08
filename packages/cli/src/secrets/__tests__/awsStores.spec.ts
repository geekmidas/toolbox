import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	DescribeSecretCommand,
	SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { SSMClient } from '@aws-sdk/client-ssm';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { ConfigLoadFailed, loadWorkspaceConfig } from '../../config';
import { AwsSecretsStore, SSM_PARAMETER_LIMIT } from '../aws';
import { StageSecretsTooLarge } from '../awsStore';
import { createStageSecrets } from '../generator';
import {
	secretsInitCommand,
	secretsSetCommand,
	secretsShowCommand,
	secretsUnsetCommand,
} from '../index';
import {
	MigrateTargetHoldsStage,
	MigrateTargetIsSource,
	secretsMigrateCommand,
} from '../migrate';
import {
	SECRETS_MANAGER_SECRET_LIMIT,
	SecretsManagerSecretsStore,
	secretsManagerSecretName,
} from '../secretsManager';
import { initStageSecrets } from '../storage';
import {
	assertKnownSecretsStore,
	type SecretsStore,
	secretsStoreFor,
	UnknownSecretsStoreProvider,
} from '../store';
import type { StageSecrets } from '../types';

/** Against the AWS emulator, through the SDK's standard endpoint variable. */
const EMULATOR = {
	AWS_ENDPOINT_URL: LOCALSTACK_URL,
	AWS_ACCESS_KEY_ID: 'test',
	AWS_SECRET_ACCESS_KEY: 'test',
};

const saved: Record<string, string | undefined> = {};

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

/** A unique project, so secrets from earlier runs never answer. */
const project = () => `aws-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

/** A stage whose serialized JSON is about `bytes` long. */
function stageOfSize(bytes: number): StageSecrets {
	const secrets = initStageSecrets('prod');
	const base = Buffer.byteLength(JSON.stringify(secrets), 'utf8');
	// `"BLOB":""` adds 9 bytes around the value.
	secrets.custom = { BLOB: 'x'.repeat(Math.max(0, bytes - base - 9)) };
	return secrets;
}

const size = (secrets: StageSecrets) =>
	Buffer.byteLength(JSON.stringify(secrets), 'utf8');

/**
 * What every AWS secrets store does: hold a stage, replace it, report a
 * stage it never held as null, and refuse a stage past its limit before
 * anything is written.
 */
function conformance(
	name: string,
	create: (project: string) => SecretsStore,
	limit: number,
) {
	describe(`${name}: the store contract`, () => {
		it('keeps a stage and reads it back', async () => {
			const store = create(project());
			const secrets = createStageSecrets('prod', ['postgres']);
			secrets.custom = { STRIPE_KEY: 'sk_live_1' };

			await store.write('prod', secrets);

			expect(await store.read('prod')).toEqual(secrets);
		});

		it('overwrites a stage on a second write', async () => {
			const store = create(project());
			const first = initStageSecrets('prod');
			const second = { ...first, custom: { ROTATED: 'yes' } };

			await store.write('prod', first);
			await store.write('prod', second);

			expect(await store.read('prod')).toEqual(second);
		});

		it('holds nothing for a stage never written', async () => {
			expect(await create(project()).read('prod')).toBeNull();
		});

		it('keeps stages apart', async () => {
			const store = create(project());
			const prod = { ...initStageSecrets('prod'), custom: { A: 'prod' } };

			await store.write('prod', prod);

			expect(await store.read('staging')).toBeNull();
			expect(await store.read('prod')).toEqual(prod);
		});

		it('holds a stage right at its limit', async () => {
			const store = create(project());
			const secrets = stageOfSize(limit);
			expect(size(secrets)).toBe(limit);

			await store.write('prod', secrets);

			expect(await store.read('prod')).toEqual(secrets);
		});

		it('refuses a stage past its limit, naming the size, and writes nothing', async () => {
			const store = create(project());
			const secrets = stageOfSize(limit + 1);

			const refused = await store.write('prod', secrets).catch((e) => e);

			expect(refused).toBeInstanceOf(StageSecretsTooLarge);
			expect(refused).toMatchObject({
				stage: 'prod',
				store: store.name,
				bytes: limit + 1,
				limit,
			});
			expect(await store.read('prod')).toBeNull();
		});
	});
}

conformance(
	'ssm',
	(name) => new AwsSecretsStore({ project: name, region: 'us-east-1' }),
	SSM_PARAMETER_LIMIT,
);

conformance(
	'secrets-manager',
	(name) =>
		new SecretsManagerSecretsStore({ project: name, region: 'us-east-1' }),
	SECRETS_MANAGER_SECRET_LIMIT,
);

describe('AwsSecretsStore tiers', () => {
	/**
	 * The emulator accepts every tier and stores parameters of any size, so
	 * what is asserted is the request the store sends — through the real
	 * client, to the emulator.
	 */
	it('writes in the Intelligent-Tiering tier, so a stage past 4 KB is accepted', async () => {
		const store = new AwsSecretsStore({
			project: project(),
			region: 'us-east-1',
		});
		const client = await (
			store as unknown as { ssm(): Promise<SSMClient> }
		).ssm();
		const sent: Record<string, unknown>[] = [];
		client.middlewareStack.add(
			(next) => async (args) => {
				sent.push(args.input as Record<string, unknown>);
				return next(args);
			},
			{ step: 'initialize' },
		);
		const secrets = stageOfSize(6 * 1024);

		await store.write('prod', secrets);

		expect(sent[0]).toMatchObject({
			Type: 'SecureString',
			Tier: 'Intelligent-Tiering',
		});
		expect(await store.read('prod')).toEqual(secrets);
	});

	it('suggests Secrets Manager for a stage SSM cannot hold', async () => {
		const store = new AwsSecretsStore({
			project: project(),
			region: 'us-east-1',
		});

		await expect(
			store.write('prod', stageOfSize(SSM_PARAMETER_LIMIT + 100)),
		).rejects.toThrow(/secrets-manager/);
	});
});

describe('SecretsManagerSecretsStore', () => {
	it('names the secret by project and stage, with no leading slash', () => {
		expect(secretsManagerSecretName('shop', 'prod')).toBe(
			'gkm/shop/prod/secrets',
		);
	});

	it('creates the secret under that name on the first write', async () => {
		const name = project();
		const store = new SecretsManagerSecretsStore({
			project: name,
			region: 'us-east-1',
		});

		await store.write('prod', initStageSecrets('prod'));

		const described = await new SecretsManagerClient({
			region: 'us-east-1',
		}).send(
			new DescribeSecretCommand({
				SecretId: secretsManagerSecretName(name, 'prod'),
			}),
		);
		expect(described.Name).toBe(`gkm/${name}/prod/secrets`);
		expect(described.Description).toBe(`gkm secrets for ${name}/prod`);
	});

	it('reaches the endpoint it is given', async () => {
		delete process.env.AWS_ENDPOINT_URL;

		try {
			const store = new SecretsManagerSecretsStore({
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

	it('resolves a named profile from the profile, never from AWS_* env', async () => {
		const home = mkdtempSync(join(tmpdir(), 'gkm-sm-home-'));
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
		process.env.AWS_ACCESS_KEY_ID = 'LSIASTAGINGKEY';

		try {
			const store = new SecretsManagerSecretsStore({
				project: 'shop',
				region: 'us-east-1',
				profile: 'acme-prod',
			});
			const client = await (
				store as unknown as {
					secretsManager(): Promise<SecretsManagerClient>;
				}
			).secretsManager();
			const resolved = await client.config.credentials();

			expect(resolved.accessKeyId).toBe('LSIAPRODKEY');
		} finally {
			process.env.AWS_ACCESS_KEY_ID = EMULATOR.AWS_ACCESS_KEY_ID;
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(home, { recursive: true, force: true });
		}
	});
});

/** What `process.exit` becomes here, so a refusal can be asserted on. */
class Exited extends Error {
	constructor(readonly code: number | undefined) {
		super(`process.exit(${code})`);
		this.name = 'Exited';
	}
}

describe('a workspace keeping its stages in Secrets Manager', () => {
	let dir: string;
	let home: string;
	let cwd: string;
	let name: string;
	const originalHome = process.env.HOME;
	let log: ReturnType<typeof vi.spyOn>;
	const printed = () => log.mock.calls.flat().join('\n');

	function writeConfig(store: string) {
		writeFileSync(
			join(dir, 'gkm.config.ts'),
			`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: '${name}',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['staging', 'prod'] },
  secrets: { store: ${store} },
});
`,
		);
	}

	const secretsManager = "{ provider: 'secrets-manager', region: 'us-east-1' }";
	const ssm = "{ provider: 'ssm', region: 'us-east-1' }";
	const workspace = async () => (await loadWorkspaceConfig(dir)).workspace;
	const inSecretsManager = (stage: string) =>
		new SecretsManagerSecretsStore({ project: name, region: 'us-east-1' }).read(
			stage,
		);
	const inSsm = (stage: string) =>
		new AwsSecretsStore({ project: name, region: 'us-east-1' }).read(stage);

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'gkm-sm-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-sm-home-'));
		name = project();
		cwd = process.cwd();
		process.chdir(dir);
		process.env.HOME = home;
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Exited(code as number | undefined);
		});
	});

	afterEach(() => {
		process.chdir(cwd);
		process.env.HOME = originalHome;
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('resolves a deployed stage to Secrets Manager, and the local one to the file', async () => {
		writeConfig(secretsManager);
		const ws = await workspace();

		expect(await secretsStoreFor(ws, 'prod')).toBeInstanceOf(
			SecretsManagerSecretsStore,
		);
		expect((await secretsStoreFor(ws, 'dev')).name).toBe('file');
	});

	it('creates a new secret with the KMS key it is given', async () => {
		writeConfig(
			"{ provider: 'secrets-manager', region: 'us-east-1', kmsKeyId: 'alias/aws/secretsmanager' }",
		);

		const store = await secretsStoreFor(await workspace(), 'prod');
		await store.write('prod', initStageSecrets('prod'));

		const described = await new SecretsManagerClient({
			region: 'us-east-1',
		}).send(
			new DescribeSecretCommand({
				SecretId: secretsManagerSecretName(name, 'prod'),
			}),
		);
		expect(described.KmsKeyId).toBeDefined();
	});

	it('refuses a provider it does not ship, by name', async () => {
		writeConfig("{ provider: 'secretsmanager', region: 'us-east-1' } as never");

		// The config is imported in a sandbox, so the refusal crosses back as
		// its message.
		const refused = await workspace().catch((e) => e);

		expect(refused).toBeInstanceOf(ConfigLoadFailed);
		expect(refused.message).toContain(
			'secrets.store names the provider "secretsmanager", which is not one gkm ships',
		);
		expect(() =>
			assertKnownSecretsStore({ provider: 'secretsmanager' }),
		).toThrow(UnknownSecretsStoreProvider);
		expect(() => assertKnownSecretsStore('ssm-parameter')).toThrow(
			UnknownSecretsStoreProvider,
		);
		for (const known of [
			undefined,
			'file',
			{ provider: 'ssm', region: 'us-east-1' },
			{ provider: 'secrets-manager', region: 'us-east-1' },
			{ provider: { name: 'vault' } },
		]) {
			expect(() => assertKnownSecretsStore(known)).not.toThrow();
		}
	});

	it('refuses an unknown provider even when the config was never validated', async () => {
		writeConfig(secretsManager);
		const ws = await workspace();
		ws.secrets = { store: { provider: 'vault' } as never };

		await expect(secretsStoreFor(ws, 'prod')).rejects.toBeInstanceOf(
			UnknownSecretsStoreProvider,
		);
	});

	it('secrets:init, set and show a stage there', async () => {
		writeConfig(secretsManager);

		await secretsInitCommand({ stage: 'prod' });
		expect(printed()).toContain('Store: secrets-manager');

		await secretsSetCommand('STRIPE_KEY', 'sk_live_sm', { stage: 'prod' });
		expect(printed()).toContain(
			'Secret "STRIPE_KEY" set for stage "prod" (secrets-manager)',
		);
		expect((await inSecretsManager('prod'))?.custom.STRIPE_KEY).toBe(
			'sk_live_sm',
		);

		await secretsShowCommand({ stage: 'prod', reveal: true });
		expect(printed()).toContain('STRIPE_KEY: sk_live_sm');
	});

	for (const [label, provider, read] of [
		['SSM', ssm, inSsm],
		['Secrets Manager', secretsManager, inSecretsManager],
	] as const) {
		it(`secrets:unset removes a key from a stage kept in ${label}`, async () => {
			writeConfig(provider);
			await secretsInitCommand({ stage: 'prod' });
			await secretsSetCommand('STRIPE_KEY', 'sk_live_kept', { stage: 'prod' });
			await secretsSetCommand(
				'AUTH_DATABASE_URL',
				'postgresql://auth:pw@localhost:5432/shop_dev',
				{ stage: 'prod' },
			);

			await secretsUnsetCommand('AUTH_DATABASE_URL', { stage: 'prod' });

			const after = await read('prod');
			expect(after?.custom).not.toHaveProperty('AUTH_DATABASE_URL');
			expect(after?.custom.STRIPE_KEY).toBe('sk_live_kept');
		});
	}

	it('secrets:migrate copies a stage from SSM to Secrets Manager whole', async () => {
		writeConfig(ssm);
		await secretsInitCommand({ stage: 'prod' });
		await secretsSetCommand('STRIPE_KEY', 'sk_live_moved', { stage: 'prod' });
		const before = await inSsm('prod');

		await secretsMigrateCommand({ stage: 'prod', to: 'secrets-manager' });

		expect(await inSecretsManager('prod')).toEqual(before);
		// The source is left as it was.
		expect(await inSsm('prod')).toEqual(before);
		expect(printed()).toContain(
			"set secrets.store to { provider: 'secrets-manager', region: 'us-east-1' }",
		);

		// Then the switch: the same commands now read Secrets Manager.
		writeConfig(secretsManager);
		await secretsShowCommand({ stage: 'prod', reveal: true });
		expect(printed()).toContain('STRIPE_KEY: sk_live_moved');
	});

	it('secrets:migrate refuses to overwrite a stage the target holds, unless forced', async () => {
		writeConfig(ssm);
		await secretsInitCommand({ stage: 'prod' });
		await new SecretsManagerSecretsStore({
			project: name,
			region: 'us-east-1',
		}).write('prod', initStageSecrets('prod'));

		await expect(
			secretsMigrateCommand({ stage: 'prod', to: 'secrets-manager' }),
		).rejects.toBeInstanceOf(MigrateTargetHoldsStage);

		await secretsMigrateCommand({
			stage: 'prod',
			to: 'secrets-manager',
			force: true,
		});
		expect(await inSecretsManager('prod')).toEqual(await inSsm('prod'));
	});

	it('secrets:migrate refuses the store the stage is already in', async () => {
		writeConfig(secretsManager);

		await expect(
			secretsMigrateCommand({ stage: 'prod', to: 'secrets-manager' }),
		).rejects.toBeInstanceOf(MigrateTargetIsSource);
		await expect(
			secretsMigrateCommand({ stage: 'prod', to: 'vault' }),
		).rejects.toBeInstanceOf(UnknownSecretsStoreProvider);
	});
});
