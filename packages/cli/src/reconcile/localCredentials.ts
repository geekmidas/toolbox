/**
 * The logins of the containers `gkm dev`, `gkm test` and the compose local
 * stage run — generated once per machine and workspace, and read back on
 * every later run.
 *
 * They used to be one fixed word, the same on every laptop, so anyone who
 * could reach a developer's Postgres could sign in to it. Now each password,
 * token and secret key is random, in the shape its service accepts, and the
 * user names are neutral ones derived from the workspace.
 *
 * **Where they are kept.** Encrypted with the local stage's key, in the CLI's
 * home beside the keys (`<home>/local/<namespace>/<project>.json`), rather
 * than in a checkout's `.gkm/`. The containers are per machine and project —
 * every checkout of a repo attaches to the same Postgres — so their logins
 * have to be too: two worktrees each generating their own would take turns
 * locking each other out of one database.
 *
 * **Why stored, not derived from a seed.** One cluster serves the local stage
 * and `test`, while a derivation is per stage; each service has its own rules
 * a hash does not meet by default; and a volume that cannot be rotated keeps
 * the login it has, which a derivation cannot express. The seed is generated
 * beside them all the same, and salts the per-role passwords the way a
 * deployed stage's does.
 */

import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { generateLogsPassword, LOCAL_LOGS_EMAIL } from '../compose/logs.js';
import { generateRedisPassword } from '../compose/redis.js';
import { generateSeed } from '../deploy/generated.js';
import { gkmHome } from '../home.js';
import {
	decrypt,
	type EncryptedSecretsFile,
	encrypt,
} from '../secrets/file.js';
import {
	getKeystoreDir,
	getOrCreateKey,
	type KeystoreProject,
	keystoreProject,
	readKey,
} from '../secrets/keystore.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { EMULATOR_ACCESS_KEY_ID } from './emulator.js';

/** A user name and its password. */
export interface Login {
	user: string;
	password: string;
}

/**
 * What every container a plan implies is brought up with, and every URL
 * that reaches one carries.
 */
export interface ContainerCredentials {
	/** The cluster's superuser — what creates databases and roles. */
	postgres: Login;
	/** MinIO's root user, which the S3 client signs with. */
	minio: Login;
	/** RabbitMQ's administrator. */
	rabbitmq: Login;
	/** Redis's `requirepass`. */
	redis: { password: string };
	/** The token the cache's HTTP proxy accepts. */
	cacheToken: string;
	/** The AWS emulator's key pair. */
	emulator: { accessKeyId: string; secretAccessKey: string };
}

/** The local stage's logins: the containers', and what else it generates. */
export interface LocalCredentials extends ContainerCredentials {
	/** Salts every per-role password, as a deployed stage's seed does. */
	seed: string;
	/** OpenObserve's root user, where `gkm compose` runs it locally. */
	logs: { email: string; password: string };
}

/** MinIO refuses a root password shorter than 8 or longer than 40. */
export const MINIO_PASSWORD_LENGTH = 32;

/** An AWS secret key is 40 characters. */
export const EMULATOR_SECRET_KEY_LENGTH = 40;

/** MinIO's root user, the same for every workspace: it is not a secret. */
export const LOCAL_MINIO_USER = 'minio';

/** RabbitMQ's administrator, the same way. */
export const LOCAL_RABBITMQ_USER = 'rabbitmq';

/**
 * The Postgres superuser for a workspace: its name as an identifier, with
 * `_admin` — never the bare name, which a database construct of the same
 * name would claim as its runtime role.
 */
export function postgresSuperuser(project: string): string {
	const slug = project
		.toLowerCase()
		.replace(/^@[^/]+\//, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/^(\d)/, '_$1');
	return `${slug || 'gkm'}_admin`;
}

/** 256 random bits, URL-safe. */
function token(): string {
	return randomBytes(32).toString('base64url');
}

/** `length` characters of letters and digits, which every client takes as is. */
function alphanumeric(length: number): string {
	const alphabet =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
	return out;
}

/** A fresh set of local logins for a workspace. */
export function generateLocalCredentials(project: string): LocalCredentials {
	return {
		seed: generateSeed(),
		postgres: { user: postgresSuperuser(project), password: token() },
		minio: {
			user: LOCAL_MINIO_USER,
			password: alphanumeric(MINIO_PASSWORD_LENGTH),
		},
		rabbitmq: { user: LOCAL_RABBITMQ_USER, password: token() },
		redis: { password: generateRedisPassword() },
		cacheToken: token(),
		emulator: {
			// Fixed: the emulator reads its account from the key id, and every
			// ARN reconcile composes names that account. Only the secret is one.
			accessKeyId: EMULATOR_ACCESS_KEY_ID,
			secretAccessKey: alphanumeric(EMULATOR_SECRET_KEY_LENGTH),
		},
		logs: { email: LOCAL_LOGS_EMAIL, password: generateLogsPassword() },
	};
}

/**
 * The stored logins with anything missing generated — a file an older gkm
 * wrote before a service existed. Pure: the caller writes the result back
 * when `generated` is not empty.
 */
export function withLocalCredentials(
	stored: Partial<LocalCredentials> | null | undefined,
	project: string,
): { credentials: LocalCredentials; generated: string[] } {
	const fresh = generateLocalCredentials(project);
	const generated = (Object.keys(fresh) as (keyof LocalCredentials)[]).filter(
		(key) => stored?.[key] === undefined,
	);
	return {
		credentials: { ...fresh, ...stored } as LocalCredentials,
		generated,
	};
}

/** Where a workspace's local logins are kept on this machine. */
export function localCredentialsPath(project: KeystoreProject): string {
	// Validates the key and splits it the way the keystore does.
	const keys = getKeystoreDir(project);
	const name = keys.split(/[\\/]/).at(-1)!;
	const namespace = keys.split(/[\\/]/).at(-2)!;
	return join(project.home ?? gkmHome(), 'local', namespace, `${name}.json`);
}

/** The local stage's logins file is there, and its key is not. */
export class LocalCredentialsKeyMissing extends Error {
	constructor(
		readonly path: string,
		readonly stage: string,
	) {
		super(
			`The local logins at ${path} are encrypted with the '${stage}' stage's ` +
				"key, and this machine has none. Remove the file to generate new ones — the containers' volumes are rotated to them on the next gkm dev.",
		);
		this.name = 'LocalCredentialsKeyMissing';
	}
}

/** Another gkm held the logins file's lock for longer than any write takes. */
export class LocalCredentialsLocked extends Error {
	constructor(readonly lock: string) {
		super(
			`Another gkm has been writing the local logins for over ${LOCK_TIMEOUT_MS / 1000}s. If none is running, remove ${lock} and run the command again.`,
		);
		this.name = 'LocalCredentialsLocked';
	}
}

/** Read the stored logins, or `null` where none were generated yet. */
export async function readLocalCredentials(
	workspace: Pick<NormalizedWorkspace, 'name' | 'root' | 'stages'> &
		Parameters<typeof keystoreProject>[0],
	home?: string,
): Promise<LocalCredentials | null> {
	const project = keystoreProject(workspace, home);
	const path = localCredentialsPath(project);
	if (!existsSync(path)) return null;

	const stage = workspace.stages.local;
	const key = await readKey(stage, project);
	if (!key) throw new LocalCredentialsKeyMissing(path, stage);
	const file = JSON.parse(
		await readFile(path, 'utf-8'),
	) as EncryptedSecretsFile;
	return decrypt<LocalCredentials>(file, key);
}

/** Write the logins, encrypted with the local stage's key, owner-only. */
export async function saveLocalCredentials(
	workspace: Parameters<typeof readLocalCredentials>[0],
	credentials: LocalCredentials,
	home?: string,
): Promise<void> {
	const project = keystoreProject(workspace, home);
	const path = localCredentialsPath(project);
	const key = await getOrCreateKey(workspace.stages.local, project);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, JSON.stringify(encrypt(credentials, key), null, 2), {
		mode: 0o600,
	});
}

/**
 * The workspace's local logins: read back, or generated and kept the first
 * time anything needs them.
 *
 * Under a lock, because a workspace's `gkm dev` starts one per app and the
 * first run of each would otherwise generate — and keep — its own.
 */
export async function loadLocalCredentials(
	workspace: Parameters<typeof readLocalCredentials>[0],
	home?: string,
): Promise<{ credentials: LocalCredentials; generated: string[] }> {
	const path = localCredentialsPath(keystoreProject(workspace, home));
	return withLock(`${path}.lock`, async () => {
		const stored = await readLocalCredentials(workspace, home);
		const result = withLocalCredentials(stored, workspace.name);
		if (result.generated.length > 0) {
			await saveLocalCredentials(workspace, result.credentials, home);
		}
		return result;
	});
}

/** How long a lock may be held before it is someone else's problem. */
const LOCK_TIMEOUT_MS = 15_000;

async function withLock<T>(lock: string, body: () => Promise<T>): Promise<T> {
	await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
	const started = Date.now();
	for (;;) {
		try {
			await mkdir(lock);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			// A lock older than any write is left over from a process that died
			// holding it.
			const age = await stat(lock)
				.then((s) => Date.now() - s.mtimeMs)
				.catch(() => 0);
			if (age > LOCK_TIMEOUT_MS) {
				await rm(lock, { recursive: true, force: true });
				continue;
			}
			if (Date.now() - started > LOCK_TIMEOUT_MS) {
				throw new LocalCredentialsLocked(lock);
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	try {
		return await body();
	} finally {
		await rm(lock, { recursive: true, force: true });
	}
}
