import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GkmConfig } from '../../types';
import {
	detectPackageManager,
	findLockfilePath,
	generateDockerEntrypoint,
	generateDockerignore,
	generateMultiStageDockerfile,
	generateSlimDockerfile,
	getLockfileName,
	hasTurboConfig,
	isMonorepo,
	resolveDockerConfig,
} from '../templates';

// Mock fs.existsSync
vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		existsSync: vi.fn(),
	};
});

const mockExistsSync = vi.mocked(existsSync);

describe('docker templates', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe('detectPackageManager', () => {
		it('should detect pnpm from lockfile', () => {
			mockExistsSync.mockImplementation((path) => {
				return String(path).includes('pnpm-lock.yaml');
			});

			expect(detectPackageManager('/test/project')).toBe('pnpm');
		});

		it('should detect npm from lockfile', () => {
			mockExistsSync.mockImplementation((path) => {
				return String(path).includes('package-lock.json');
			});

			expect(detectPackageManager('/test/project')).toBe('npm');
		});

		it('should detect yarn from lockfile', () => {
			mockExistsSync.mockImplementation((path) => {
				return String(path).includes('yarn.lock');
			});

			expect(detectPackageManager('/test/project')).toBe('yarn');
		});

		it('should detect bun from lockfile', () => {
			mockExistsSync.mockImplementation((path) => {
				return String(path).includes('bun.lockb');
			});

			expect(detectPackageManager('/test/project')).toBe('bun');
		});

		it('should default to pnpm when no lockfile found', () => {
			mockExistsSync.mockReturnValue(false);

			expect(detectPackageManager('/test/project')).toBe('pnpm');
		});

		it('should prioritize pnpm over npm when both exist', () => {
			mockExistsSync.mockImplementation((path) => {
				const pathStr = String(path);
				return (
					pathStr.includes('pnpm-lock.yaml') ||
					pathStr.includes('package-lock.json')
				);
			});

			// pnpm should be detected first due to order
			expect(detectPackageManager('/test/project')).toBe('pnpm');
		});
	});

	describe('generateMultiStageDockerfile', () => {
		const baseOptions = {
			imageName: 'my-app',
			baseImage: 'node:22-alpine',
			port: 3000,
			healthCheckPath: '/health',
			prebuilt: false,
			packageManager: 'pnpm' as const,
		};

		it('should generate Dockerfile with BuildKit syntax', () => {
			const dockerfile = generateMultiStageDockerfile(baseOptions);

			expect(dockerfile).toContain('# syntax=docker/dockerfile:1');
		});

		it('should include three stages: deps, builder, runner', () => {
			const dockerfile = generateMultiStageDockerfile(baseOptions);

			expect(dockerfile).toContain('FROM node:22-alpine AS deps');
			expect(dockerfile).toContain('FROM deps AS builder');
			expect(dockerfile).toContain('FROM node:22-alpine AS runner');
		});

		it('should use pnpm fetch for better caching', () => {
			const dockerfile = generateMultiStageDockerfile(baseOptions);

			expect(dockerfile).toContain('pnpm fetch');
		});

		it('should install tini for signal handling', () => {
			const dockerfile = generateMultiStageDockerfile(baseOptions);

			expect(dockerfile).toContain('apk add --no-cache tini');
			expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--"]');
		});

		it('should create non-root user', () => {
			const dockerfile = generateMultiStageDockerfile(baseOptions);

			expect(dockerfile).toContain('addgroup --system --gid 1001 nodejs');
			expect(dockerfile).toContain('adduser --system --uid 1001 hono');
			expect(dockerfile).toContain('USER hono');
		});

		it('should include health check', () => {
			const dockerfile = generateMultiStageDockerfile(baseOptions);

			expect(dockerfile).toContain('HEALTHCHECK');
			expect(dockerfile).toContain('/health');
		});

		it('should expose configured port', () => {
			const dockerfile = generateMultiStageDockerfile(baseOptions);

			expect(dockerfile).toContain('EXPOSE 3000');
			expect(dockerfile).toContain('ENV PORT=3000');
		});

		it('should use npm when specified', () => {
			const dockerfile = generateMultiStageDockerfile({
				...baseOptions,
				packageManager: 'npm',
			});

			expect(dockerfile).toContain('npm ci');
			expect(dockerfile).not.toContain('pnpm');
		});

		it('should use yarn when specified', () => {
			const dockerfile = generateMultiStageDockerfile({
				...baseOptions,
				packageManager: 'yarn',
			});

			expect(dockerfile).toContain('yarn install --frozen-lockfile');
			expect(dockerfile).toContain('yarn.lock');
		});

		it('should generate turbo Dockerfile when turbo option is set', () => {
			const dockerfile = generateMultiStageDockerfile({
				...baseOptions,
				turbo: true,
				turboPackage: 'api',
			});

			expect(dockerfile).toContain('turbo');
			expect(dockerfile).toContain('pruner');
		});
	});

	describe('generateSlimDockerfile', () => {
		const baseOptions = {
			imageName: 'my-app',
			baseImage: 'node:22-alpine',
			port: 3000,
			healthCheckPath: '/health',
			prebuilt: true,
			packageManager: 'pnpm' as const,
		};

		it('should generate single-stage Dockerfile', () => {
			const dockerfile = generateSlimDockerfile(baseOptions);

			// Should not have multiple FROM statements
			const fromMatches = dockerfile.match(/FROM\s+/g);
			expect(fromMatches?.length).toBe(1);
		});

		it('should copy pre-built bundle', () => {
			const dockerfile = generateSlimDockerfile(baseOptions);

			expect(dockerfile).toContain('COPY .gkm/server/dist/server.mjs');
		});

		it('should install tini', () => {
			const dockerfile = generateSlimDockerfile(baseOptions);

			expect(dockerfile).toContain('tini');
		});

		it('should include health check', () => {
			const dockerfile = generateSlimDockerfile(baseOptions);

			expect(dockerfile).toContain('HEALTHCHECK');
		});
	});

	describe('generateDockerignore', () => {
		it('should include common ignores', () => {
			const ignore = generateDockerignore();

			expect(ignore).toContain('node_modules');
			expect(ignore).toContain('.git');
			expect(ignore).toContain('.env');
		});

		it('should not ignore .gkm/server/dist for slim builds', () => {
			const ignore = generateDockerignore();

			expect(ignore).toContain('!.gkm/server/dist');
		});
	});

	describe('generateDockerEntrypoint', () => {
		it('should generate shell entrypoint script', () => {
			const entrypoint = generateDockerEntrypoint();

			expect(entrypoint).toContain('#!/bin/sh');
			expect(entrypoint).toContain('exec');
		});

		it('should set error handling', () => {
			const entrypoint = generateDockerEntrypoint();

			expect(entrypoint).toContain('set -e');
		});
	});

	describe('resolveDockerConfig', () => {
		it('should use defaults when no config provided', () => {
			const config: GkmConfig = {};
			const result = resolveDockerConfig(config);

			// imageName comes from package.json or defaults to 'api'
			expect(typeof result.imageName).toBe('string');
			expect(result.baseImage).toBe('node:22-alpine');
			expect(result.port).toBe(3000);
		});

		it('should use config values when provided', () => {
			const config: GkmConfig = {
				docker: {
					imageName: 'my-custom-app',
					baseImage: 'node:20-alpine',
					port: 8080,
				},
			};
			const result = resolveDockerConfig(config);

			expect(result.imageName).toBe('my-custom-app');
			expect(result.baseImage).toBe('node:20-alpine');
			expect(result.port).toBe(8080);
		});

		it('should merge partial config with defaults', () => {
			const config: GkmConfig = {
				docker: {
					imageName: 'partial-app',
				},
			};
			const result = resolveDockerConfig(config);

			expect(result.imageName).toBe('partial-app');
			expect(result.baseImage).toBe('node:22-alpine'); // default
			expect(result.port).toBe(3000); // default
		});
	});

	describe('findLockfilePath', () => {
		it('should find pnpm-lock.yaml in current directory', () => {
			mockExistsSync.mockImplementation((path) => {
				return path === join('/test/project', 'pnpm-lock.yaml');
			});

			expect(findLockfilePath('/test/project')).toBe(
				join('/test/project', 'pnpm-lock.yaml'),
			);
		});

		it('should find lockfile in parent directory (monorepo)', () => {
			mockExistsSync.mockImplementation((path) => {
				// Lockfile only exists at monorepo root
				return path === join('/test', 'pnpm-lock.yaml');
			});

			expect(findLockfilePath('/test/project/apps/api')).toBe(
				join('/test', 'pnpm-lock.yaml'),
			);
		});

		it('should find yarn.lock when present', () => {
			mockExistsSync.mockImplementation((path) => {
				return path === join('/test/project', 'yarn.lock');
			});

			expect(findLockfilePath('/test/project')).toBe(
				join('/test/project', 'yarn.lock'),
			);
		});

		it('should find package-lock.json when present', () => {
			mockExistsSync.mockImplementation((path) => {
				return path === join('/test/project', 'package-lock.json');
			});

			expect(findLockfilePath('/test/project')).toBe(
				join('/test/project', 'package-lock.json'),
			);
		});

		it('should find bun.lockb when present', () => {
			mockExistsSync.mockImplementation((path) => {
				return path === join('/test/project', 'bun.lockb');
			});

			expect(findLockfilePath('/test/project')).toBe(
				join('/test/project', 'bun.lockb'),
			);
		});

		it('should return null when no lockfile found', () => {
			mockExistsSync.mockReturnValue(false);

			expect(findLockfilePath('/test/project')).toBeNull();
		});

		it('should prioritize lockfiles in order: pnpm, bun, yarn, npm', () => {
			// If multiple lockfiles exist, pnpm should be found first
			mockExistsSync.mockImplementation((path) => {
				const pathStr = String(path);
				return (
					pathStr.endsWith('pnpm-lock.yaml') ||
					pathStr.endsWith('package-lock.json')
				);
			});

			const result = findLockfilePath('/test/project');
			expect(result).toContain('pnpm-lock.yaml');
		});
	});

	describe('getLockfileName', () => {
		it('should return pnpm-lock.yaml for pnpm', () => {
			expect(getLockfileName('pnpm')).toBe('pnpm-lock.yaml');
		});

		it('should return package-lock.json for npm', () => {
			expect(getLockfileName('npm')).toBe('package-lock.json');
		});

		it('should return yarn.lock for yarn', () => {
			expect(getLockfileName('yarn')).toBe('yarn.lock');
		});

		it('should return bun.lockb for bun', () => {
			expect(getLockfileName('bun')).toBe('bun.lockb');
		});
	});

	describe('isMonorepo', () => {
		it('should return false when lockfile is in current directory', () => {
			mockExistsSync.mockImplementation((path) => {
				return path === join('/test/project', 'pnpm-lock.yaml');
			});

			expect(isMonorepo('/test/project')).toBe(false);
		});

		it('should return true when lockfile is in parent directory', () => {
			mockExistsSync.mockImplementation((path) => {
				return path === join('/test', 'pnpm-lock.yaml');
			});

			expect(isMonorepo('/test/project/apps/api')).toBe(true);
		});

		it('should return false when no lockfile found', () => {
			mockExistsSync.mockReturnValue(false);

			expect(isMonorepo('/test/project')).toBe(false);
		});
	});

	describe('hasTurboConfig', () => {
		it('should return true when turbo.json exists in current directory', () => {
			mockExistsSync.mockImplementation((path) => {
				return path === join('/test/project', 'turbo.json');
			});

			expect(hasTurboConfig('/test/project')).toBe(true);
		});

		it('should return true when turbo.json exists in parent directory', () => {
			mockExistsSync.mockImplementation((path) => {
				return path === join('/test', 'turbo.json');
			});

			expect(hasTurboConfig('/test/project/apps/api')).toBe(true);
		});

		it('should return false when turbo.json not found', () => {
			mockExistsSync.mockReturnValue(false);

			expect(hasTurboConfig('/test/project')).toBe(false);
		});
	});
});
