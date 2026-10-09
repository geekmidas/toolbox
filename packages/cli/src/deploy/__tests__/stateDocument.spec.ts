/**
 * Deploy state v3: a compose shape of its own, DNS records as resources, who
 * wrote each write, and the v2 documents before it read and upgraded.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentActor, describeActor } from '../actor';
import {
	dnsResourceKey,
	dnsResources,
	recordDnsChanges,
	recordDnsResource,
} from '../dnsResources';
import { DeployJournal } from '../journal';
import { LocalStateStore } from '../LocalStateStore';
import {
	assertStateOutlivesRun,
	LocalStateInCi,
	STATE_HISTORY,
} from '../StateStore';
import { createComposeState, type DokployStageState } from '../state';

const STAGE = 'production';

/** What a v2 compose deploy left: the Dokploy shape, every Dokploy field empty. */
const composeV2 = {
	schemaVersion: 2,
	stage: STAGE,
	serial: 7,
	state: {
		provider: 'dokploy',
		stage: STAGE,
		projectId: '',
		environmentId: '',
		applications: {},
		services: {},
		identity: 'acme/shop',
		releases: {
			api: {
				current: {
					ref: 'ghcr.io/acme/api:v2',
					digest: 'sha256:bbb',
					releasedAt: '2026-09-02T00:00:00.000Z',
				},
				history: [
					{
						ref: 'ghcr.io/acme/api:v2',
						digest: 'sha256:bbb',
						releasedAt: '2026-09-02T00:00:00.000Z',
					},
				],
			},
		},
		dnsRecords: {
			'api:A': {
				domain: 'shop.example.com',
				name: 'api',
				type: 'A',
				value: '203.0.113.10',
				ttl: 600,
				createdAt: '2026-09-01T00:00:00.000Z',
			},
			'@:A': {
				domain: 'shop.example.com',
				name: '@',
				type: 'A',
				value: '203.0.113.10',
				ttl: 600,
				createdAt: '2026-09-01T00:00:00.000Z',
			},
		},
		dnsVerified: {
			'api.shop.example.com': {
				serverIp: '203.0.113.10',
				verifiedAt: '2026-09-01T00:00:00.000Z',
			},
		},
		lastDeployedAt: '2026-09-02T00:00:00.000Z',
	},
	resources: {},
	updatedAt: '2026-09-02T00:00:00.000Z',
};

const dokployV2State: DokployStageState = {
	provider: 'dokploy',
	stage: STAGE,
	projectId: 'proj_1',
	environmentId: 'env_1',
	applications: { api: 'app_api' },
	services: { postgresId: 'pg_1' },
	dnsVerified: {
		'api.shop.example.com': {
			serverIp: '203.0.113.10',
			verifiedAt: '2026-09-01T00:00:00.000Z',
		},
	},
	lastDeployedAt: '2026-09-02T00:00:00.000Z',
};

const dokployV2 = {
	schemaVersion: 2,
	stage: STAGE,
	serial: 3,
	state: dokployV2State,
	resources: {
		project: {
			key: 'project',
			type: 'project',
			id: 'proj_1',
			status: 'ready',
			updatedAt: '2026-09-02T00:00:00.000Z',
		},
	},
	updatedAt: '2026-09-02T00:00:00.000Z',
};

describe('the writer', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('is the GitHub Actions run, from its environment', () => {
		expect(
			currentActor({
				GITHUB_ACTIONS: 'true',
				GITHUB_ACTOR: 'octocat',
				GITHUB_SERVER_URL: 'https://github.com',
				GITHUB_REPOSITORY: 'acme/shop',
				GITHUB_RUN_ID: '1234',
				GITHUB_WORKFLOW: 'Deploy',
			}),
		).toEqual({
			kind: 'github',
			actor: 'octocat',
			run: 'https://github.com/acme/shop/actions/runs/1234',
			workflow: 'Deploy',
		});
	});

	it('is user@host anywhere else', () => {
		const actor = currentActor({ CI: 'true' });
		expect(actor).toEqual({
			kind: 'local',
			user: userInfo().username,
			host: hostname(),
		});
		expect(describeActor(actor)).toBe(`${userInfo().username}@${hostname()}`);
	});
});

describe('state documents', () => {
	let root: string;
	let store: LocalStateStore;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-state-doc-'));
		store = new LocalStateStore(root);
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	});

	const plant = async (document: unknown) => {
		await mkdir(join(root, '.gkm'), { recursive: true });
		await writeFile(store.statePath(STAGE), JSON.stringify(document));
	};
	const onDisk = async () =>
		JSON.parse(await readFile(store.statePath(STAGE), 'utf-8'));

	describe('a v2 document compose wrote', () => {
		it('reads as the compose shape, its DNS records as dns-record resources', async () => {
			await plant(composeV2);

			const stored = await store.read(STAGE);

			expect(stored?.state).toEqual({
				provider: 'compose',
				stage: STAGE,
				lastDeployedAt: '2026-09-02T00:00:00.000Z',
				identity: 'acme/shop',
				releases: composeV2.state.releases,
			});
			expect(stored?.resources).toEqual({
				'dns-record:api.shop.example.com:A': {
					key: 'dns-record:api.shop.example.com:A',
					type: 'dns-record',
					id: 'api.shop.example.com A',
					status: 'ready',
					data: {
						domain: 'shop.example.com',
						name: 'api',
						value: '203.0.113.10',
						ttl: 600,
					},
					updatedAt: '2026-09-01T00:00:00.000Z',
				},
				'dns-record:shop.example.com:A': expect.objectContaining({
					id: 'shop.example.com A',
				}),
			});
			// Read only: nothing is written until something writes.
			expect((await onDisk()).schemaVersion).toBe(2);
		});

		it('is written as v3 by the next write', async () => {
			await plant(composeV2);
			const stored = await store.read(STAGE);

			await store.write(STAGE, stored!.state, {
				expectedVersion: stored!.version,
			});

			const document = await onDisk();
			expect(document).toMatchObject({
				schemaVersion: 3,
				serial: 8,
				state: { provider: 'compose' },
				updatedBy: currentActor(),
				history: [{ serial: 8, operation: 'write', by: currentActor() }],
			});
			expect(document.state).not.toHaveProperty('dnsRecords');
			expect(document.state).not.toHaveProperty('dnsVerified');
			expect(document.state).not.toHaveProperty('projectId');
			expect(Object.keys(document.resources).sort()).toEqual([
				'dns-record:api.shop.example.com:A',
				'dns-record:shop.example.com:A',
			]);
		});
	});

	describe('a v2 document Dokploy wrote', () => {
		it('keeps its state and records exactly, gaining only updatedBy and history', async () => {
			await plant(dokployV2);
			const stored = await store.read(STAGE);
			expect(stored?.state).toEqual(dokployV2State);
			expect(stored?.resources).toEqual(dokployV2.resources);

			await store.write(STAGE, stored!.state, {
				expectedVersion: stored!.version,
			});

			const { updatedBy, history, updatedAt, ...document } = await onDisk();
			const { updatedAt: _before, ...v2 } = dokployV2;
			expect(document).toEqual({ ...v2, schemaVersion: 3, serial: 4 });
			expect(updatedBy).toEqual(currentActor());
			expect(history).toEqual([
				{ serial: 4, at: updatedAt, by: currentActor(), operation: 'write' },
			]);
		});
	});

	describe('history', () => {
		it('is one entry per run however many writes it makes, newest first', async () => {
			const deploy = await store.lock(STAGE, { operation: 'deploy' });
			const journal = await DeployJournal.open(store, STAGE, () =>
				createComposeState(STAGE),
			);
			await journal.ready({ key: 'a', type: 't' }, '1');
			await journal.ready({ key: 'b', type: 't' }, '2');
			await journal.save();
			await deploy.release();

			const rollback = await store.lock(STAGE, { operation: 'rollback' });
			await (
				await DeployJournal.open(store, STAGE, () => createComposeState(STAGE))
			).save();
			await rollback.release();

			const document = await onDisk();
			expect(document.serial).toBe(5);
			expect(
				document.history.map((h: { serial: number; operation: string }) => [
					h.serial,
					h.operation,
				]),
			).toEqual([
				[5, 'rollback'],
				[4, 'deploy'],
			]);
		});

		it('keeps the last 20 writes', async () => {
			let version = await store.write(STAGE, createComposeState(STAGE), {
				expectedVersion: null,
			});
			for (let i = 0; i < 25; i++) {
				version = await store.write(STAGE, createComposeState(STAGE), {
					expectedVersion: version,
				});
			}

			const { history } = (await store.read(STAGE))!;
			expect(history).toHaveLength(STATE_HISTORY);
			expect(history[0]!.serial).toBe(26);
			expect(history.at(-1)!.serial).toBe(7);
		});

		it('names the GitHub run that wrote it', async () => {
			vi.stubEnv('GITHUB_ACTIONS', 'true');
			vi.stubEnv('GITHUB_ACTOR', 'octocat');
			vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
			vi.stubEnv('GITHUB_REPOSITORY', 'acme/shop');
			vi.stubEnv('GITHUB_RUN_ID', '99');
			// A GitHub runner sets its own; without this the actor gains `workflow`.
			vi.stubEnv('GITHUB_WORKFLOW', '');

			await store.write(STAGE, createComposeState(STAGE), {
				expectedVersion: null,
			});

			expect((await onDisk()).updatedBy).toEqual({
				kind: 'github',
				actor: 'octocat',
				run: 'https://github.com/acme/shop/actions/runs/99',
			});
		});
	});

	describe('DNS records', () => {
		it('keeps what a DNS step wrote, updates its value, and forgets what it deleted', async () => {
			const journal = await DeployJournal.open(store, STAGE, () =>
				createComposeState(STAGE),
			);
			await recordDnsChanges(
				journal,
				[
					{
						domain: 'shop.example.com',
						name: 'api',
						type: 'A',
						action: 'create',
						value: '203.0.113.10',
						ttl: 600,
					},
					{
						domain: 'shop.example.com',
						name: 'www',
						type: 'A',
						action: 'unchanged',
						value: '203.0.113.10',
						ttl: 600,
					},
					{
						domain: 'shop.example.com',
						name: 'auth',
						type: 'A',
						action: 'manual',
						value: '203.0.113.10',
						ttl: 600,
					},
				],
				() => 'godaddy',
			);

			expect(Object.keys((await store.read(STAGE))!.resources)).toEqual([
				dnsResourceKey('api.shop.example.com', 'A'),
			]);

			await recordDnsResource(journal, {
				domain: 'shop.example.com',
				name: 'api',
				type: 'A',
				value: '198.51.100.1',
				ttl: 600,
				provider: 'godaddy',
			});
			expect(dnsResources((await store.read(STAGE))!.resources)).toEqual([
				{
					fqdn: 'api.shop.example.com',
					domain: 'shop.example.com',
					name: 'api',
					type: 'A',
					value: '198.51.100.1',
					ttl: 600,
					provider: 'godaddy',
				},
			]);

			await recordDnsChanges(
				journal,
				[
					{
						domain: 'shop.example.com',
						name: 'api',
						type: 'A',
						action: 'delete',
					},
				],
				() => 'godaddy',
			);
			expect((await store.read(STAGE))!.resources).toEqual({});
		});
	});
});

describe('LocalStateInCi', () => {
	const workspace = (state?: { provider: 'local' } | undefined) => ({
		...(state ? { state } : {}),
		stages: { local: 'development' },
		secrets: { store: { provider: 'ssm', region: 'eu-west-1' } },
	});

	it('refuses a deployed stage with local state on GitHub Actions', () => {
		const error = (() => {
			try {
				assertStateOutlivesRun(workspace(), 'production', 'deploy', {
					GITHUB_ACTIONS: 'true',
				});
			} catch (e) {
				return e;
			}
		})();

		expect(error).toBeInstanceOf(LocalStateInCi);
		expect((error as Error).message).toContain(
			"state: { provider: 's3', region: 'eu-west-1' }",
		);
		expect((error as Error).message).toContain(
			'gkm state:push --stage production',
		);
	});

	it("refuses on any runner that sets CI, 'local' named or not", () => {
		expect(() =>
			assertStateOutlivesRun(
				workspace({ provider: 'local' }),
				'production',
				'deploy:rollback',
				{ CI: 'true' },
			),
		).toThrow(LocalStateInCi);
	});

	it('allows local state outside CI, the local stage in CI, and SSM state in CI', () => {
		expect(() =>
			assertStateOutlivesRun(workspace(), 'production', 'deploy', {}),
		).not.toThrow();
		expect(() =>
			assertStateOutlivesRun(workspace(), 'development', 'deploy', {
				GITHUB_ACTIONS: 'true',
			}),
		).not.toThrow();
		expect(() =>
			assertStateOutlivesRun(
				{
					state: { provider: 'ssm', region: 'eu-west-1' },
					stages: { local: 'development' },
				},
				'production',
				'deploy',
				{ GITHUB_ACTIONS: 'true' },
			),
		).not.toThrow();
	});
});
