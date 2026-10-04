/**
 * `gkm encryption:rotate` and `gkm encryption:retire` — the keyring of an
 * `Encryption` construct on a server stage.
 *
 * Rotating adds a key in front and keeps every older one, so what they wrote
 * still opens. Retiring removes one, and is the half that makes rotating worth
 * doing: until a key is gone, it still opens everything it ever wrote. It is
 * never automatic, because the only thing that knows nothing is left under a
 * key is the sweep that re-encrypted the column — so it is done after one,
 * deliberately, by name.
 *
 * Neither applies everywhere, and each says so rather than doing something
 * that looks right: a local stage's keyring is derived and would be replaced on
 * the next `gkm dev`, and on AWS the key is KMS's, which rotates it itself and
 * never strands a value.
 */

import {
	parseKeyring,
	retireKey,
	rotateKeyring,
} from '@geekmidas/constructs/encryption';
import { canonicalId, provideKey } from '@geekmidas/manifest';
import { loadWorkspaceSettings } from '../config';
import { withCustomSecret } from '../secrets/storage.js';
import { type SecretsStore, secretsStoreFor } from '../secrets/store.js';
import { providerOf } from '../workspace/backends.js';
import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

const logger = console;

export class LocalKeyringIsDerived extends Error {
	constructor(
		readonly construct: string,
		readonly stage: string,
	) {
		super(
			`'${stage}' is the local stage, where ${construct}'s keyring is derived from the project and stage — nothing stored there would be read. Rotate a deployed stage: gkm encryption:rotate ${construct} --stage <stage>.`,
		);
		this.name = 'LocalKeyringIsDerived';
	}
}

export class KmsRotatesItself extends Error {
	constructor(readonly construct: string) {
		super(
			`${construct} is a KMS key on AWS: KMS rotates it yearly and keeps every version, so no value is ever stranded and there is no key to retire. Nothing to do here.`,
		);
		this.name = 'KmsRotatesItself';
	}
}

export class NoKeyringYet extends Error {
	constructor(
		readonly construct: string,
		readonly stage: string,
		readonly key: string,
	) {
		super(
			`'${stage}' has no ${key} yet. The first deploy generates ${construct}'s keyring: gkm deploy --stage ${stage}.`,
		);
		this.name = 'NoKeyringYet';
	}
}

export interface EncryptionCommandOptions {
	stage: string;
}

/** Where a command reads and writes; the real ones unless a test says. */
export interface EncryptionCommandContext {
	workspace?: NormalizedWorkspace;
	store?: SecretsStore;
}

export async function encryptionRotateCommand(
	construct: string,
	options: EncryptionCommandOptions,
	context: EncryptionCommandContext = {},
): Promise<string> {
	return updateKeyring(construct, options, context, (id, url) => {
		const next = rotateKeyring(id, url);
		const [current, ...older] = parseKeyring(id, next).keys.map(({ id }) => id);

		logger.log(`\n✓ ${id} on '${options.stage}' now writes with '${current}'.`);
		logger.log(
			`  Still opening: ${older.join(', ')}. Redeploy to start writing with '${current}', reencrypt what is stored, then: gkm encryption:retire ${id} <key> --stage ${options.stage}`,
		);
		return next;
	});
}

export async function encryptionRetireCommand(
	construct: string,
	keyId: string,
	options: EncryptionCommandOptions,
	context: EncryptionCommandContext = {},
): Promise<string> {
	return updateKeyring(construct, options, context, (id, url) => {
		const next = retireKey(id, url, keyId);

		logger.log(
			`\n✓ ${id} on '${options.stage}' no longer holds '${keyId}'. Anything still under it cannot be read after the next deploy.`,
		);
		return next;
	});
}

async function updateKeyring(
	construct: string,
	{ stage }: EncryptionCommandOptions,
	context: EncryptionCommandContext,
	update: (id: string, url: string) => string,
): Promise<string> {
	const workspace = context.workspace ?? (await loadWorkspaceSettings());
	const id = canonicalId(construct);

	if (stage === workspace.stages.local) {
		throw new LocalKeyringIsDerived(id, stage);
	}
	assertDeployedStage(workspace.stages, stage);
	if (providerOf(workspace) === 'aws') throw new KmsRotatesItself(id);

	const store = context.store ?? (await secretsStoreFor(workspace, stage));
	const key = provideKey(id, 'url');
	const secrets = await store.read(stage);
	const url = secrets?.custom[key];
	if (!secrets || !url) throw new NoKeyringYet(id, stage, key);

	const next = update(id, url);
	await store.write(stage, withCustomSecret(secrets, key, next));
	return next;
}
