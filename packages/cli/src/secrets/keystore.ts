/**
 * The keys that open each stage's encrypted secrets file, kept outside the
 * project in the CLI's home.
 *
 * Keys were kept at `~/.gkm/<folder>/<stage>.key`, named after the project
 * directory — so two checkouts in folders with the same name (`~/work/api`
 * and `~/oss/api`) shared one key, and the second `gkm secrets:init`
 * overwrote the first project's. They are now kept under the project's
 * identity, `<home>/keys/<namespace>/<project>/<stage>.key`, the same
 * `<namespace>/<project>` a deploy claims its Dokploy project by. A key still
 * at the old place is copied to the new one the first time it is read; the
 * old file stays, so an older CLI on the same machine keeps working.
 */

import { randomBytes } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import {
	chmod,
	copyFile,
	mkdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deployIdentity, type IdentitySource } from '../deploy/identity';
import { GkmError } from '../errors';
import { gkmHome } from '../home';

/** Key length for AES-256 encryption */
const KEY_LENGTH = 32; // 256 bits

/** Whose keys, and where the CLI's home is. */
export interface KeystoreProject {
	/** `<namespace>/<project>`, as `DeployIdentity.key` spells it. */
	key: string;
	/**
	 * The names the project's keys were kept under, `~/.gkm/<name>/`, before
	 * they were keyed by identity: its directory's basename, which the secrets
	 * file used, and its workspace name, which `gkm init` and the generated CI
	 * workflow wrote to. Looked in, and copied from, when the project has no
	 * key of its own yet.
	 */
	legacy?: readonly string[];
	/**
	 * Other project keys this project's keys may be copied from when it has
	 * none: the default namespace's, for a workspace that has just set
	 * `deploy.namespace` — the secrets file in the checkout is the same one.
	 */
	aliases?: string[];
	/** The CLI's home. Defaults to `GKM_HOME`, else `~/.gkm`. */
	home?: string;
}

/** A keystore project key that is not `<namespace>/<project>`. */
export class KeystoreProjectInvalid extends GkmError {
	constructor(readonly key: string) {
		super(
			`'${key}' is not a keystore project: expected '<namespace>/<project>' in lowercase letters, digits and '-', as deployIdentity() produces. Pass the workspace's identity key.`,
		);
		this.name = 'KeystoreProjectInvalid';
	}
}

/** A stage has no key, here or at the place keys used to be kept. */
export class KeyNotFound extends GkmError {
	constructor(
		readonly stage: string,
		readonly project: string,
		readonly path: string,
	) {
		super(
			`Encryption key not found for stage "${stage}" in project "${project}". ` +
				`Expected key at: ${path}. Run \`gkm secrets:init --stage ${stage}\` to create one, or copy the stage's key there.`,
		);
		this.name = 'KeyNotFound';
	}
}

const PROJECT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The keystore key of a workspace: its deploy identity without the stage, so
 * a project's keys and its Dokploy project are named by the same thing.
 */
export function projectKey(workspace: IdentitySource): string {
	return deployIdentity(workspace, '').key;
}

/** The keystore project of a loaded workspace. */
export function keystoreProject(
	workspace: IdentitySource & { root: string },
	home?: string,
): KeystoreProject {
	const key = projectKey(workspace);
	const unscoped = projectKey({ name: workspace.name });
	const legacy = [
		...new Set([folderName(workspace.root), workspace.name]),
	].filter((name): name is string => !!name);
	return {
		key,
		legacy,
		...(unscoped !== key ? { aliases: [unscoped] } : {}),
		...(home ? { home } : {}),
	};
}

/**
 * Whether `name` stays inside the home it is joined to. A workspace name was
 * joined as is — `@acme/shop` is `~/.gkm/@acme/shop` — but never upwards.
 */
function isLegacyName(name: string): boolean {
	return name.split(/[\\/]/).every((part) => part !== '..' && part !== '');
}

/** The last segment of a path, as the old keystore named projects. */
function folderName(path: string): string | undefined {
	const name = path.split(/[\\/]/).filter(Boolean).at(-1);
	return name && name !== '.' && name !== '..' ? name : undefined;
}

/**
 * Get the keystore directory for a project:
 * `<home>/keys/<namespace>/<project>`.
 */
export function getKeystoreDir(project: KeystoreProject): string {
	if (!PROJECT_KEY.test(project.key)) {
		throw new KeystoreProjectInvalid(project.key);
	}
	const [namespace, name] = project.key.split('/') as [string, string];
	return join(project.home ?? gkmHome(), 'keys', namespace, name);
}

/** Get the path to a stage's encryption key. */
export function getKeyPath(stage: string, project: KeystoreProject): string {
	return join(getKeystoreDir(project), `${stage}.key`);
}

/**
 * Where else a stage's key may be, most likely first: under an alias of the
 * project, then where keys were kept before they were keyed by identity —
 * under the configured home, then under `~/.gkm`, which is where every CLI
 * before `GKM_HOME` wrote.
 */
function legacyKeyPaths(stage: string, project: KeystoreProject): string[] {
	const aliases = (project.aliases ?? []).map((key) =>
		getKeyPath(stage, { key, home: project.home }),
	);
	const homes = [
		...new Set([project.home ?? gkmHome(), join(homedir(), '.gkm')]),
	];
	const names = (project.legacy ?? []).filter(isLegacyName);
	return [
		...aliases,
		...names.flatMap((name) =>
			homes.map((home) => join(home, name, `${stage}.key`)),
		),
	];
}

/** Check if a key exists for a stage, here or where it used to be kept. */
export function keyExists(stage: string, project: KeystoreProject): boolean {
	return (
		existsSync(getKeyPath(stage, project)) ||
		legacyKeyPaths(stage, project).some((path) => existsSync(path))
	);
}

/**
 * Generate a new encryption key for a stage, stored owner-only at
 * `<home>/keys/<namespace>/<project>/<stage>.key`.
 */
export async function generateKey(
	stage: string,
	project: KeystoreProject,
	/** `wx` to refuse replacing a key that is already there. */
	flag: 'w' | 'wx' = 'w',
): Promise<string> {
	const keyDir = getKeystoreDir(project);
	const keyPath = getKeyPath(stage, project);

	// Ensure keystore directory exists with restricted permissions
	await mkdir(keyDir, { recursive: true, mode: 0o700 });

	// Generate random key
	const key = randomBytes(KEY_LENGTH).toString('hex');

	// Write key with restricted permissions (owner read/write only)
	await writeFile(keyPath, key, { mode: 0o600, encoding: 'utf-8', flag });

	// Ensure permissions are set correctly (in case file existed)
	await chmod(keyPath, 0o600);

	return key;
}

/**
 * Copy a key from where it used to be kept to where it is kept now.
 *
 * Copied, not moved: an older CLI on the same machine still reads the old
 * place. Exclusive, so two processes migrating at once cannot overwrite a key
 * one of them already put there.
 */
async function migrateLegacyKey(
	stage: string,
	project: KeystoreProject,
): Promise<boolean> {
	const legacy = legacyKeyPaths(stage, project).find((path) =>
		existsSync(path),
	);
	if (!legacy) return false;

	const keyPath = getKeyPath(stage, project);
	await mkdir(getKeystoreDir(project), { recursive: true, mode: 0o700 });
	try {
		await copyFile(legacy, keyPath, constants.COPYFILE_EXCL);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
	}
	await chmod(keyPath, 0o600);
	return true;
}

/**
 * Read an encryption key for a stage, or `null` when there is none — after
 * copying it over from where keys used to be kept, if it is still there.
 */
export async function readKey(
	stage: string,
	project: KeystoreProject,
): Promise<string | null> {
	const keyPath = getKeyPath(stage, project);

	if (!existsSync(keyPath) && !(await migrateLegacyKey(stage, project))) {
		return null;
	}

	const key = await readFile(keyPath, 'utf-8');
	return key.trim();
}

/**
 * Read an encryption key for a stage, throwing {@link KeyNotFound} if there
 * is none.
 */
export async function requireKey(
	stage: string,
	project: KeystoreProject,
): Promise<string> {
	const key = await readKey(stage, project);

	if (!key) {
		throw new KeyNotFound(stage, project.key, getKeyPath(stage, project));
	}

	return key;
}

/**
 * Delete a key for a stage. Only the current one: a key left at the old place
 * belongs to whichever older CLI still reads it.
 */
export async function deleteKey(
	stage: string,
	project: KeystoreProject,
): Promise<void> {
	await rm(getKeyPath(stage, project), { force: true });
}

/**
 * Get or create a key for a stage.
 * If the key already exists, it is returned. Otherwise, a new key is generated.
 */
export async function getOrCreateKey(
	stage: string,
	project: KeystoreProject,
): Promise<string> {
	const existingKey = await readKey(stage, project);

	if (existingKey) {
		return existingKey;
	}

	// Exclusively: a key is now shared by every checkout of one project, and
	// two commands creating it at once must not each keep a different one.
	try {
		return await generateKey(stage, project, 'wx');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		return requireKey(stage, project);
	}
}
