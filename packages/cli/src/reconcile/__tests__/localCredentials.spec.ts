import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isStrongLogsPassword } from '../../compose/logs';
import { keystoreProject } from '../../secrets/keystore';
import { composeFor, toYaml } from '../compose';
import { portKeys } from '../containers';
import { EMULATOR_ACCESS_KEY_ID } from '../emulator';
import { envFor } from '../env';
import {
	EMULATOR_SECRET_KEY_LENGTH,
	generateLocalCredentials,
	type LocalCredentials,
	LocalCredentialsKeyMissing,
	loadLocalCredentials,
	localCredentialsPath,
	MINIO_PASSWORD_LENGTH,
	postgresSuperuser,
	readLocalCredentials,
	withLocalCredentials,
} from '../localCredentials';
import { planFor } from '../plan';

/** Every password, token and secret key a set of logins holds. */
function secretsOf(credentials: LocalCredentials): string[] {
	return [
		credentials.seed,
		credentials.postgres.password,
		credentials.minio.password,
		credentials.rabbitmq.password,
		credentials.redis.password,
		credentials.cacheToken,
		credentials.emulator.secretAccessKey,
		credentials.logs.password,
	];
}

describe('generated local logins', () => {
	it('meet each service’s rules', () => {
		for (let i = 0; i < 25; i++) {
			const credentials = generateLocalCredentials('shop');

			// MinIO: a root user of 3–20 characters, a password of 8–40.
			expect(credentials.minio.user.length).toBeGreaterThanOrEqual(3);
			expect(credentials.minio.user.length).toBeLessThanOrEqual(20);
			expect(credentials.minio.password).toMatch(
				new RegExp(`^[A-Za-z0-9]{${MINIO_PASSWORD_LENGTH}}$`),
			);
			// The emulator: LocalStack's recognisable key id, an AWS-shaped secret.
			expect(credentials.emulator.accessKeyId).toBe(EMULATOR_ACCESS_KEY_ID);
			expect(credentials.emulator.accessKeyId).toMatch(/^LSIA[A-Z0-9]{16}$/);
			expect(credentials.emulator.secretAccessKey).toMatch(
				new RegExp(`^[A-Za-z0-9]{${EMULATOR_SECRET_KEY_LENGTH}}$`),
			);
			// OpenObserve: 8–128 characters, every class.
			expect(isStrongLogsPassword(credentials.logs.password)).toBe(true);
			// Everything else rides in a URL's userinfo: URL-safe, 256 bits.
			for (const value of [
				credentials.postgres.password,
				credentials.redis.password,
				credentials.rabbitmq.password,
				credentials.cacheToken,
				credentials.seed,
			]) {
				expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
			}
		}
	});

	it('are different on every machine', () => {
		const one = generateLocalCredentials('shop');
		const two = generateLocalCredentials('shop');

		for (const [index, secret] of secretsOf(one).entries()) {
			expect(secret).not.toBe(secretsOf(two)[index]);
		}
	});

	it('name their users after the workspace, never the maintainer', () => {
		const credentials = generateLocalCredentials('kitchen-sink');

		expect(credentials.postgres.user).toBe('kitchen_sink_admin');
		expect(credentials.minio.user).toBe('minio');
		expect(credentials.rabbitmq.user).toBe('rabbitmq');
		expect(JSON.stringify(credentials).toLowerCase()).not.toContain(
			'geekmidas',
		);
	});

	it('make the superuser a Postgres identifier, apart from any role a database claims', () => {
		expect(postgresSuperuser('@acme/Shop App')).toBe('shop_app_admin');
		expect(postgresSuperuser('7eleven')).toBe('_7eleven_admin');
		expect(postgresSuperuser('---')).toBe('gkm_admin');
		// A database construct called `shop` connects as the role `shop`.
		expect(postgresSuperuser('shop')).not.toBe('shop');
	});

	it('fill in only what an older file lacks', () => {
		const stored = generateLocalCredentials('shop');
		const { cacheToken: _dropped, ...older } = stored;

		const { credentials, generated } = withLocalCredentials(older, 'shop');

		expect(generated).toEqual(['cacheToken']);
		expect({ ...credentials, cacheToken: undefined }).toEqual({
			...stored,
			cacheToken: undefined,
		});
		expect(credentials.cacheToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});

describe('keeping them', () => {
	let home: string;
	let root: string;

	const workspaceAt = (dir: string, name = 'shop') => ({
		name,
		root: dir,
		stages: { local: 'dev', deployed: ['prod'] },
	});

	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), 'gkm-home-'));
		root = await mkdtemp(join(tmpdir(), 'gkm-local-'));
	});

	afterEach(async () => {
		await rm(home, { recursive: true, force: true });
		await rm(root, { recursive: true, force: true });
	});

	it('generates them on first need, and reads the same ones back after', async () => {
		const workspace = workspaceAt(root);

		const first = await loadLocalCredentials(workspace, home);
		const second = await loadLocalCredentials(workspace, home);

		expect(first.generated.length).toBeGreaterThan(0);
		expect(second.generated).toEqual([]);
		expect(second.credentials).toEqual(first.credentials);
		expect(await readLocalCredentials(workspace, home)).toEqual(
			first.credentials,
		);
	});

	it('keeps them encrypted, owner-only, in the CLI’s home — not the checkout', async () => {
		const workspace = workspaceAt(root);
		const { credentials } = await loadLocalCredentials(workspace, home);
		const path = localCredentialsPath(keystoreProject(workspace, home));

		expect(path.startsWith(home)).toBe(true);
		expect(existsSync(join(root, '.gkm'))).toBe(false);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		const raw = await readFile(path, 'utf-8');
		for (const secret of secretsOf(credentials)) {
			expect(raw).not.toContain(secret);
		}
	});

	it('shares one set between every checkout of a project, which share its containers', async () => {
		const other = await mkdtemp(join(tmpdir(), 'gkm-local-'));
		try {
			const one = await loadLocalCredentials(workspaceAt(root), home);
			const two = await loadLocalCredentials(workspaceAt(other), home);

			expect(two.generated).toEqual([]);
			expect(two.credentials).toEqual(one.credentials);
		} finally {
			await rm(other, { recursive: true, force: true });
		}
	});

	it('keeps another project’s apart', async () => {
		const one = await loadLocalCredentials(workspaceAt(root, 'shop'), home);
		const two = await loadLocalCredentials(workspaceAt(root, 'blog'), home);

		expect(two.credentials.postgres.password).not.toBe(
			one.credentials.postgres.password,
		);
	});

	it('generates one set when many processes ask at once', async () => {
		const workspace = workspaceAt(root);

		const all = await Promise.all(
			Array.from({ length: 6 }, () => loadLocalCredentials(workspace, home)),
		);

		expect(all.filter((result) => result.generated.length > 0)).toHaveLength(1);
		for (const result of all) {
			expect(result.credentials).toEqual(all[0]!.credentials);
		}
	});

	it('refuses to guess when the key that opens them is gone', async () => {
		const workspace = workspaceAt(root);
		await loadLocalCredentials(workspace, home);
		await rm(join(home, 'keys'), { recursive: true, force: true });

		await expect(readLocalCredentials(workspace, home)).rejects.toBeInstanceOf(
			LocalCredentialsKeyMissing,
		);
	});
});

describe('what gkm writes from them', () => {
	const credentials = generateLocalCredentials('shop');
	const manifest = {
		Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
		Ledger: {
			kind: 'database',
			id: 'Ledger',
			roles: false,
			provides: ['LEDGER_URL'],
		},
		Sessions: { kind: 'cache', id: 'Sessions', provides: ['SESSIONS_URL'] },
		Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
		Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
		Emails: {
			kind: 'queue',
			id: 'Emails',
			worker: { id: 'EmailsWorker', handler: 'h', dependencies: [] },
			provides: ['EMAILS_PUBLISHER_CONNECTION_STRING'],
		},
	} as unknown as ConstructManifest;

	/** The compose file and env a stage resolves, on each events backend. */
	const written = (['pgboss', 'rabbitmq', 'sns'] as const).flatMap((events) =>
		(['redis', 'upstash'] as const).map((cache) => {
			const plan = planFor(manifest, 'dev', provisionOrder(manifest), {
				localStage: 'dev',
				events,
				cache,
			});
			const ports = Object.fromEntries(
				portKeys(plan.containers).map((key, i) => [key, 30000 + i]),
			);
			return [
				toYaml(composeFor(plan, { project: 'shop', ports, credentials })),
				JSON.stringify(
					envFor(plan, {
						ports,
						project: 'shop',
						credentials,
						seed: credentials.seed,
					}),
				),
			].join('\n');
		}),
	);

	it('never holds the old fixed login', () => {
		for (const text of written) {
			expect(text.toLowerCase()).not.toContain('geekmidas');
		}
	});

	it('carries the generated ones', () => {
		const all = written.join('\n');

		expect(all).toContain(credentials.postgres.password);
		expect(all).toContain(credentials.minio.password);
		expect(all).toContain(credentials.redis.password);
		expect(all).toContain(credentials.rabbitmq.password);
		expect(all).toContain(credentials.emulator.secretAccessKey);
	});
});
