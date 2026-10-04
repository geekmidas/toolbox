import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	generateKeyring,
	keyringCipher,
	parseKeyring,
} from '@geekmidas/constructs/encryption';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSecretsStore } from '../../secrets/file';
import { initStageSecrets, withCustomSecret } from '../../secrets/storage';
import { UndeclaredStage } from '../../workspace/stages';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	encryptionRetireCommand,
	encryptionRotateCommand,
	KmsRotatesItself,
	LocalKeyringIsDerived,
	NoKeyringYet,
} from '../index';

const workspace = (target = 'dokploy') =>
	({
		name: 'shop',
		root: '/shop',
		stages: { local: 'dev', deployed: ['prod'] },
		deploy: { default: target },
		secrets: {},
	}) as unknown as NormalizedWorkspace;

describe('encryption:rotate and encryption:retire', () => {
	let root: string;
	let store: FileSecretsStore;

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), 'gkm-encryption-'));
		store = new FileSecretsStore(root);
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	/** A stage whose first deploy generated `Pii`'s keyring. */
	async function deployed(): Promise<string> {
		const keyring = generateKeyring();
		await store.write(
			'prod',
			withCustomSecret(initStageSecrets('prod'), 'PII_URL', keyring),
		);
		return keyring;
	}

	const context = () => ({ workspace: workspace(), store });
	const stored = async () => (await store.read('prod'))!.custom.PII_URL!;
	const keyIds = (url: string) =>
		parseKeyring('Pii', url).keys.map(({ id }) => id);

	it('rotates in the stage’s store, keeping every key that wrote something', async () => {
		const v1 = await deployed();
		const old = await keyringCipher('Pii', v1).encrypt('kept');

		await encryptionRotateCommand('Pii', { stage: 'prod' }, context());

		expect(keyIds(await stored())).toEqual(['k2', 'k1']);
		expect(await keyringCipher('Pii', await stored()).decrypt(old)).toBe(
			'kept',
		);
	});

	it('retires an old key once the sweep is done', async () => {
		await deployed();
		await encryptionRotateCommand('Pii', { stage: 'prod' }, context());

		await encryptionRetireCommand('Pii', 'k1', { stage: 'prod' }, context());

		expect(keyIds(await stored())).toEqual(['k2']);
	});

	it('refuses the local stage, whose keyring is derived and would be replaced', async () => {
		await expect(
			encryptionRotateCommand('Pii', { stage: 'dev' }, context()),
		).rejects.toBeInstanceOf(LocalKeyringIsDerived);
	});

	it('refuses a stage the project does not deploy', async () => {
		await expect(
			encryptionRotateCommand('Pii', { stage: 'staging' }, context()),
		).rejects.toBeInstanceOf(UndeclaredStage);
	});

	it('says KMS does it on AWS, and touches nothing', async () => {
		const keyring = await deployed();

		await expect(
			encryptionRotateCommand(
				'Pii',
				{ stage: 'prod' },
				{ workspace: workspace('sst'), store },
			),
		).rejects.toBeInstanceOf(KmsRotatesItself);
		expect(await stored()).toBe(keyring);
	});

	it('points at the first deploy when the stage has no keyring yet', async () => {
		await store.write('prod', initStageSecrets('prod'));

		await expect(
			encryptionRotateCommand('Pii', { stage: 'prod' }, context()),
		).rejects.toBeInstanceOf(NoKeyringYet);
	});
});
