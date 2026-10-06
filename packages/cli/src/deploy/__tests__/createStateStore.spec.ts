import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LegacyStateStore } from '../LegacyStateStore';
import { LocalStateStore } from '../LocalStateStore';
import { S3StateStore } from '../S3StateStore';
import { SSMStateStore } from '../SSMStateStore';
import type { StateProvider } from '../StateProvider';
import {
	createStateStore,
	StateStoreNeedsWorkspaceName,
	StateStoreWithoutLocking,
	StateVersionConflict,
	UnknownStateProvider,
} from '../StateStore';
import type { DokployStageState } from '../state';
import { dokployState } from './__helpers__/stateStoreConformance';

const STAGE = 'production';

/** A custom provider as users write them: a map, read and written whole. */
class MapStateProvider implements StateProvider {
	readonly states = new Map<string, string>();

	async read(stage: string): Promise<DokployStageState | null> {
		const json = this.states.get(stage);
		return json ? JSON.parse(json) : null;
	}

	async write(stage: string, state: DokployStageState): Promise<void> {
		state.lastDeployedAt = new Date().toISOString();
		this.states.set(stage, JSON.stringify(state));
	}
}

describe('createStateStore', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-create-store-'));
	});

	it('stores locally when nothing is configured', async () => {
		const store = await createStateStore({
			workspaceRoot: root,
			workspaceName: 'app',
		});

		expect(store).toBeInstanceOf(LocalStateStore);
	});

	it('stores locally for provider: local', async () => {
		const store = await createStateStore({
			config: { provider: 'local' },
			workspaceRoot: root,
			workspaceName: 'app',
		});

		expect(store).toBeInstanceOf(LocalStateStore);
	});

	it('reads SSM directly for provider: ssm, with no local cache in front', async () => {
		const store = await createStateStore({
			config: { provider: 'ssm', region: 'us-east-1' },
			workspaceRoot: root,
			workspaceName: 'app',
		});

		expect(store).toBeInstanceOf(SSMStateStore);
	});

	it('stores in S3 for provider: s3', async () => {
		const store = await createStateStore({
			config: { provider: 's3', bucket: 'state', region: 'us-east-1' },
			workspaceRoot: root,
			workspaceName: 'app',
		});

		expect(store).toBeInstanceOf(S3StateStore);
		expect((store as S3StateStore).bucket).toBe('state');
	});

	it.each([
		'ssm',
		's3',
	] as const)('needs a workspace name for provider: %s', async (provider) => {
		await expect(
			createStateStore({
				config:
					provider === 'ssm'
						? { provider, region: 'us-east-1' }
						: { provider, bucket: 'b', region: 'us-east-1' },
				workspaceRoot: root,
				workspaceName: '',
			}),
		).rejects.toBeInstanceOf(StateStoreNeedsWorkspaceName);
	});

	it('uses a custom StateStore as is', async () => {
		const custom = new LocalStateStore(root);

		const store = await createStateStore({
			config: { provider: custom },
			workspaceRoot: root,
			workspaceName: 'app',
		});

		expect(store).toBe(custom);
	});

	it('wraps a custom StateProvider in the legacy adapter', async () => {
		const store = await createStateStore({
			config: { provider: new MapStateProvider() },
			workspaceRoot: root,
			workspaceName: 'app',
			warn: () => {},
		});

		expect(store).toBeInstanceOf(LegacyStateStore);
	});

	it('names an unknown provider', async () => {
		await expect(
			createStateStore({
				config: { provider: 'etcd' } as never,
				workspaceRoot: root,
				workspaceName: 'app',
			}),
		).rejects.toBeInstanceOf(UnknownStateProvider);
	});
});

describe('LegacyStateStore', () => {
	it('warns StateStoreWithoutLocking once, however often it is used', async () => {
		const warnings: StateStoreWithoutLocking[] = [];
		const store = new LegacyStateStore(new MapStateProvider(), {
			warn: (warning) => warnings.push(warning),
		});

		const lock = await store.lock(STAGE);
		const version = await store.write(STAGE, dokployState(STAGE), {
			expectedVersion: null,
		});
		await store.putResource(
			STAGE,
			{ key: 'redis', type: 'redis', status: 'pending' },
			{ expectedVersion: version },
		);
		await lock.release();

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toBeInstanceOf(StateStoreWithoutLocking);
		expect(warnings[0]?.provider).toBe('MapStateProvider');
	});

	it('emits the warning as a process warning by default', async () => {
		const seen: Error[] = [];
		const listener = (warning: Error) => seen.push(warning);
		process.on('warning', listener);
		try {
			await new LegacyStateStore(new MapStateProvider()).lock(STAGE);
			await new Promise((resolve) => setImmediate(resolve));
		} finally {
			process.off('warning', listener);
		}

		expect(seen.some((w) => w.name === 'StateStoreWithoutLocking')).toBe(true);
	});

	it('reads back what it wrote, at the version it returned', async () => {
		const store = new LegacyStateStore(new MapStateProvider(), {
			warn: () => {},
		});

		const version = await store.write(STAGE, dokployState(STAGE), {
			expectedVersion: null,
		});

		expect((await store.read(STAGE))?.version).toBe(version);
	});

	it('still refuses a write based on a stale version', async () => {
		const provider = new MapStateProvider();
		const store = new LegacyStateStore(provider, { warn: () => {} });
		const stale = await store.write(STAGE, dokployState(STAGE), {
			expectedVersion: null,
		});
		await store.write(STAGE, dokployState(STAGE, { projectId: 'p2' }), {
			expectedVersion: stale,
		});

		await expect(
			store.write(STAGE, dokployState(STAGE), { expectedVersion: stale }),
		).rejects.toBeInstanceOf(StateVersionConflict);
	});

	it('keeps resource records inside the state the provider stores', async () => {
		const provider = new MapStateProvider();
		const store = new LegacyStateStore(provider, { warn: () => {} });
		await store.write(STAGE, dokployState(STAGE), { expectedVersion: null });

		await store.putResource(STAGE, {
			key: 'redis',
			type: 'redis',
			id: 'redis_1',
			status: 'ready',
		});

		const stored = await store.read(STAGE);
		expect(stored?.resources.redis?.id).toBe('redis_1');
		expect(stored?.state).not.toHaveProperty('resources');
		expect(JSON.parse(provider.states.get(STAGE)!).resources.redis.id).toBe(
			'redis_1',
		);
	});
});
