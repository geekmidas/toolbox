import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { writeComposeApp } from '../../compose/__tests__/__helpers__/composeApp';
import { loadWorkspaceConfig } from '../../config';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import {
	type LocalCredentials,
	loadLocalCredentials,
} from '../../reconcile/localCredentials';
import { describeLogins } from '../../reconcile/serviceLogins';
import {
	type DevCredentialsOutput,
	devCredentials,
	devCredentialsCommand,
	NoLocalCredentials,
} from '../credentials';

const workspace = {
	name: 'shop',
	stages: { local: 'dev', deployed: ['prod'] },
	deploy: {},
} as Parameters<typeof devCredentials>[0];

/** What `.gkm/ports.json` holds after a `gkm dev` with these containers. */
const PORTS = {
	postgres: 20705,
	mailpit: 20701,
	'mailpit-web': 20702,
	minio: 20703,
	'minio-console': 20704,
	redis: 20706,
	caddy: 20700,
};

describe('devCredentials', () => {
	const output = devCredentials(workspace, TEST_CREDENTIALS, PORTS);
	const by = (service: string) =>
		output.services.find((login) => login.service === service);

	it('gives Postgres as a connection string, password and all', () => {
		expect(by('postgres')).toEqual({
			service: 'postgres',
			label: 'Postgres',
			url: 'postgres://shop_admin:pg-secret@localhost:20705/postgres',
			user: 'shop_admin',
			password: 'pg-secret',
		});
	});

	it('gives the MinIO console with its root login', () => {
		expect(by('minio')).toMatchObject({
			url: 'http://localhost:20704',
			user: TEST_CREDENTIALS.minio.user,
			password: TEST_CREDENTIALS.minio.password,
		});
	});

	it('says Mailpit takes no login', () => {
		expect(by('mailpit')).toEqual({
			service: 'mailpit',
			label: 'Mailpit inbox',
			url: 'http://localhost:20702',
			note: 'no login',
		});
	});

	it('gives Redis where it was published', () => {
		expect(by('redis')?.password).toBe(TEST_CREDENTIALS.redis.password);
	});

	it('lists only what was published — never the edge, which has no login', () => {
		expect(output.services.map((login) => login.service)).toEqual([
			'postgres',
			'minio',
			'mailpit',
			'redis',
		]);
	});

	it('adds OpenObserve where the local compose stack runs it', () => {
		const withLogs = devCredentials(
			{ ...workspace, deploy: { compose: { logs: true } } } as typeof workspace,
			TEST_CREDENTIALS,
			PORTS,
		);

		expect(withLogs.services.at(-1)).toMatchObject({
			service: 'openobserve',
			url: 'http://localhost:5080',
			user: TEST_CREDENTIALS.logs.email,
			password: TEST_CREDENTIALS.logs.password,
			note: 'when running: gkm compose --stage dev',
		});
	});

	it('prints a line per service, its login under it', () => {
		expect(describeLogins(output.services)).toEqual([
			'   Postgres       postgres://shop_admin:pg-secret@localhost:20705/postgres',
			'                  user shop_admin, password pg-secret',
			'   MinIO console  http://localhost:20704',
			`                  user minio, password ${TEST_CREDENTIALS.minio.password} — S3 API on http://localhost:20703`,
			'   Mailpit inbox  http://localhost:20702',
			'                  no login',
			`   Redis          redis://:${TEST_CREDENTIALS.redis.password}@localhost:20706`,
			`                  password ${TEST_CREDENTIALS.redis.password}`,
		]);
	});
});

describe('gkm dev:credentials', () => {
	let dir: string;
	let cwd: string;
	let credentials: LocalCredentials;

	beforeAll(async () => {
		dir = realpathSync(await createTempDir('gkm-dev-credentials-'));
		writeComposeApp(dir);
		// A home of its own: other suites generate logins for this fixture's
		// workspace in the shared one.
		vi.stubEnv('GKM_HOME', join(dir, '.gkm-home'));
		cwd = process.cwd();
		process.chdir(dir);
	});

	afterEach(() => {
		process.chdir(dir);
	});

	afterAll(async () => {
		process.chdir(cwd);
		vi.unstubAllEnvs();
		await cleanupDir(dir);
	});

	it('says to start the services first, where nothing generated logins yet', async () => {
		await expect(devCredentialsCommand({}, () => {})).rejects.toBeInstanceOf(
			NoLocalCredentials,
		);
	});

	describe('once gkm dev ran', () => {
		beforeAll(async () => {
			const { workspace: loaded } = await loadWorkspaceConfig(dir);
			({ credentials } = await loadLocalCredentials(loaded));
			await mkdir(join(dir, '.gkm'), { recursive: true });
			await writeFile(join(dir, '.gkm', 'ports.json'), JSON.stringify(PORTS));
		});

		it('prints each service’s address and this machine’s login', async () => {
			const lines: string[] = [];
			await devCredentialsCommand({}, (line) => lines.push(line));

			expect(lines[0]).toBe('🔑 Local logins for compose-app (development)');
			const text = lines.join('\n');
			expect(text).toContain(
				`postgres://${credentials.postgres.user}:${credentials.postgres.password}@localhost:20705/postgres`,
			);
			expect(text).toContain(
				`user minio, password ${credentials.minio.password}`,
			);
			expect(text).toContain('Mailpit inbox  http://localhost:20702');
			expect(text.toLowerCase()).not.toContain('geekmidas');
		});

		it('prints the same as JSON with --json', async () => {
			const lines: string[] = [];
			await devCredentialsCommand({ json: true }, (line) => lines.push(line));

			expect(lines).toHaveLength(1);
			const output = JSON.parse(lines[0]!) as DevCredentialsOutput;
			expect(output.workspace).toBe('compose-app');
			expect(output.stage).toBe('development');
			expect(
				output.services.find((login) => login.service === 'postgres'),
			).toMatchObject({
				user: credentials.postgres.user,
				password: credentials.postgres.password,
			});
		});
	});
});
