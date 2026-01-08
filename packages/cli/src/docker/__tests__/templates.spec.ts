import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GkmConfig } from '../../types';
import {
	detectPackageManager,
	generateDockerEntrypoint,
	generateDockerignore,
	generateMultiStageDockerfile,
	generateSlimDockerfile,
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
});
