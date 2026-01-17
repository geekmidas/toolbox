import { describe, expect, it } from 'vitest';
import { CachedStateProvider } from '../CachedStateProvider';
import type { StateProvider } from '../StateProvider';
import type { DokployStageState } from '../state';

const createMockProvider = (): StateProvider & {
	readCalls: string[];
	writeCalls: Array<{ stage: string; state: DokployStageState }>;
	storage: Map<string, DokployStageState>;
} => {
	const storage = new Map<string, DokployStageState>();
	const readCalls: string[] = [];
	const writeCalls: Array<{ stage: string; state: DokployStageState }> = [];

	return {
		storage,
		readCalls,
		writeCalls,
		async read(stage: string): Promise<DokployStageState | null> {
			readCalls.push(stage);
			return storage.get(stage) ?? null;
		},
		async write(stage: string, state: DokployStageState): Promise<void> {
			writeCalls.push({ stage, state });
			storage.set(stage, { ...state });
		},
	};
};

describe('CachedStateProvider', () => {
	describe('read', () => {
		it('should return local state if available', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'local_app' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};
			local.storage.set('production', state);

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.read('production');

			expect(result).toEqual(state);
			expect(local.readCalls).toEqual(['production']);
			expect(remote.readCalls).toEqual([]);
		});

		it('should fetch from remote and cache locally if local missing', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'remote_app' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};
			remote.storage.set('production', state);

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.read('production');

			expect(result).toEqual(state);
			expect(local.readCalls).toEqual(['production']);
			expect(remote.readCalls).toEqual(['production']);
			expect(local.writeCalls.length).toBe(1);
			expect(local.writeCalls[0].stage).toBe('production');
		});

		it('should return null if both local and remote are empty', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.read('nonexistent');

			expect(result).toBeNull();
			expect(local.readCalls).toEqual(['nonexistent']);
			expect(remote.readCalls).toEqual(['nonexistent']);
		});
	});

	describe('write', () => {
		it('should write to both remote and local', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const state: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'app_123' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};

			const cached = new CachedStateProvider(remote, local);
			await cached.write('production', state);

			expect(remote.writeCalls.length).toBe(1);
			expect(remote.writeCalls[0].stage).toBe('production');
			expect(local.writeCalls.length).toBe(1);
			expect(local.writeCalls[0].stage).toBe('production');
		});
	});

	describe('pull', () => {
		it('should fetch from remote and update local', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const remoteState: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'remote_app' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};
			remote.storage.set('production', remoteState);

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.pull('production');

			expect(result).toEqual(remoteState);
			expect(remote.readCalls).toEqual(['production']);
			expect(local.writeCalls.length).toBe(1);
		});

		it('should return null if remote is empty', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.pull('nonexistent');

			expect(result).toBeNull();
			expect(local.writeCalls.length).toBe(0);
		});
	});

	describe('push', () => {
		it('should push local state to remote', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const localState: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'local_app' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};
			local.storage.set('production', localState);

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.push('production');

			expect(result).toEqual(localState);
			expect(local.readCalls).toEqual(['production']);
			expect(remote.writeCalls.length).toBe(1);
		});

		it('should return null if local is empty', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.push('nonexistent');

			expect(result).toBeNull();
			expect(remote.writeCalls.length).toBe(0);
		});
	});

	describe('diff', () => {
		it('should return both local and remote state', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const localState: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'local_app' },
				services: {},
				lastDeployedAt: '2024-01-01T00:00:00.000Z',
			};
			const remoteState: DokployStageState = {
				provider: 'dokploy',
				stage: 'production',
				environmentId: 'env_123',
				applications: { api: 'remote_app' },
				services: {},
				lastDeployedAt: '2024-01-02T00:00:00.000Z',
			};

			local.storage.set('production', localState);
			remote.storage.set('production', remoteState);

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.diff('production');

			expect(result.local).toEqual(localState);
			expect(result.remote).toEqual(remoteState);
		});

		it('should handle missing states', async () => {
			const local = createMockProvider();
			const remote = createMockProvider();

			const cached = new CachedStateProvider(remote, local);
			const result = await cached.diff('nonexistent');

			expect(result.local).toBeNull();
			expect(result.remote).toBeNull();
		});
	});
});
