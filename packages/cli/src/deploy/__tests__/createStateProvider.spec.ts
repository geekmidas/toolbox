import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CachedStateProvider } from '../CachedStateProvider';
import { LocalStateProvider } from '../LocalStateProvider';
import {
	createStateProvider,
	isStateProvider,
	type StateProvider,
} from '../StateProvider';

describe('createStateProvider', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `gkm-state-factory-test-${Date.now()}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('isStateProvider', () => {
		it('should return true for valid provider', () => {
			const provider = {
				read: async () => null,
				write: async () => {},
			};
			expect(isStateProvider(provider)).toBe(true);
		});

		it('should return false for null', () => {
			expect(isStateProvider(null)).toBe(false);
		});

		it('should return false for undefined', () => {
			expect(isStateProvider(undefined)).toBe(false);
		});

		it('should return false for empty object', () => {
			expect(isStateProvider({})).toBe(false);
		});

		it('should return false for object with only read', () => {
			expect(isStateProvider({ read: () => {} })).toBe(false);
		});

		it('should return false for object with only write', () => {
			expect(isStateProvider({ write: () => {} })).toBe(false);
		});
	});

	describe('local provider', () => {
		it('should create LocalStateProvider when no config', async () => {
			const provider = await createStateProvider({
				workspaceRoot: testDir,
				workspaceName: 'test',
			});

			expect(provider).toBeInstanceOf(LocalStateProvider);
		});

		it('should create LocalStateProvider when provider is local', async () => {
			const provider = await createStateProvider({
				config: { provider: 'local' },
				workspaceRoot: testDir,
				workspaceName: 'test',
			});

			expect(provider).toBeInstanceOf(LocalStateProvider);
		});
	});

	describe('ssm provider', () => {
		it('should throw when workspace name is missing', async () => {
			await expect(
				createStateProvider({
					config: { provider: 'ssm', region: 'us-east-1' },
					workspaceRoot: testDir,
					workspaceName: '',
				}),
			).rejects.toThrow('Workspace name is required');
		});

		it('should create CachedStateProvider for ssm config', async () => {
			const provider = await createStateProvider({
				config: { provider: 'ssm', region: 'us-east-1' },
				workspaceRoot: testDir,
				workspaceName: 'test-workspace',
			});

			expect(provider).toBeInstanceOf(CachedStateProvider);
		});

		it('should create CachedStateProvider for ssm config with profile', async () => {
			const provider = await createStateProvider({
				config: { provider: 'ssm', region: 'us-east-1', profile: 'my-profile' },
				workspaceRoot: testDir,
				workspaceName: 'test-workspace',
			});

			expect(provider).toBeInstanceOf(CachedStateProvider);
		});
	});

	describe('custom provider', () => {
		it('should use custom provider implementation', async () => {
			const customProvider: StateProvider = {
				async read(): Promise<null> {
					return null;
				},
				async write(): Promise<void> {},
			};

			const provider = await createStateProvider({
				config: { provider: customProvider },
				workspaceRoot: testDir,
				workspaceName: 'test',
			});

			expect(provider).toBe(customProvider);
		});
	});
});
