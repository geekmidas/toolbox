import { describe, expect, it } from 'vitest';
import type { NormalizedAppConfig } from '../../workspace/types';
import {
	generatePublicUrlBuildArgs,
	getPublicUrlArgNames,
	isMainFrontendApp,
	resolveHost,
} from '../domain';

describe('resolveHost', () => {
	const dokployConfig = {
		endpoint: 'https://dokploy.example.com',
		projectId: 'test-project',
		domains: {
			development: 'dev.myapp.com',
			staging: 'staging.myapp.com',
			production: 'myapp.com',
		},
	};

	const createApp = (
		overrides: Partial<NormalizedAppConfig> = {},
	): NormalizedAppConfig => ({
		type: 'backend',
		path: 'apps/api',
		port: 3000,
		dependencies: [],
		resolvedDeployTarget: 'dokploy',
		...overrides,
	});

	it('should return explicit app domain override (string)', () => {
		const app = createApp({ domain: 'api.custom.com' });
		const host = resolveHost('api', app, 'production', dokployConfig, false);
		expect(host).toBe('api.custom.com');
	});

	it('should return stage-specific domain override', () => {
		const app = createApp({
			domain: {
				production: 'login.myapp.com',
				staging: 'login.staging.myapp.com',
			},
		});
		const host = resolveHost('auth', app, 'production', dokployConfig, false);
		expect(host).toBe('login.myapp.com');
	});

	it('should fallback to base domain pattern when no stage match in override', () => {
		const app = createApp({
			domain: { production: 'custom.myapp.com' },
		});
		const host = resolveHost('api', app, 'development', dokployConfig, false);
		expect(host).toBe('api.dev.myapp.com');
	});

	it('should return base domain for main frontend app', () => {
		const app = createApp({ type: 'frontend' });
		const host = resolveHost('web', app, 'production', dokployConfig, true);
		expect(host).toBe('myapp.com');
	});

	it('should return prefixed domain for non-main apps', () => {
		const app = createApp();
		const host = resolveHost('api', app, 'production', dokployConfig, false);
		expect(host).toBe('api.myapp.com');
	});

	it('should use correct base domain for each stage', () => {
		const app = createApp();

		expect(resolveHost('api', app, 'development', dokployConfig, false)).toBe(
			'api.dev.myapp.com',
		);
		expect(resolveHost('api', app, 'staging', dokployConfig, false)).toBe(
			'api.staging.myapp.com',
		);
		expect(resolveHost('api', app, 'production', dokployConfig, false)).toBe(
			'api.myapp.com',
		);
	});

	it('should throw error when no domain configured for stage', () => {
		const app = createApp();
		expect(() =>
			resolveHost('api', app, 'unknown-stage', dokployConfig, false),
		).toThrow('No domain configured for stage "unknown-stage"');
	});

	it('should throw error when dokployConfig has no domains', () => {
		const app = createApp();
		const configWithoutDomains = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'test-project',
		};
		expect(() =>
			resolveHost('api', app, 'production', configWithoutDomains, false),
		).toThrow('No domain configured for stage "production"');
	});
});

describe('isMainFrontendApp', () => {
	const createApp = (type: 'backend' | 'frontend'): NormalizedAppConfig => ({
		type,
		path: 'apps/test',
		port: 3000,
		dependencies: [],
		resolvedDeployTarget: 'dokploy',
	});

	it('should return false for backend apps', () => {
		const apps = {
			api: createApp('backend'),
			web: createApp('frontend'),
		};
		expect(isMainFrontendApp('api', apps.api, apps)).toBe(false);
	});

	it('should return true for app named "web" if it is frontend', () => {
		const apps = {
			api: createApp('backend'),
			web: createApp('frontend'),
			admin: createApp('frontend'),
		};
		expect(isMainFrontendApp('web', apps.web, apps)).toBe(true);
	});

	it('should return true for first frontend app when no "web" app', () => {
		const apps = {
			api: createApp('backend'),
			dashboard: createApp('frontend'),
			admin: createApp('frontend'),
		};
		expect(isMainFrontendApp('dashboard', apps.dashboard, apps)).toBe(true);
		expect(isMainFrontendApp('admin', apps.admin, apps)).toBe(false);
	});

	it('should return false for non-first frontend when no "web" app', () => {
		const apps = {
			api: createApp('backend'),
			dashboard: createApp('frontend'),
			admin: createApp('frontend'),
		};
		expect(isMainFrontendApp('admin', apps.admin, apps)).toBe(false);
	});
});

describe('generatePublicUrlBuildArgs', () => {
	const createApp = (dependencies: string[]): NormalizedAppConfig => ({
		type: 'frontend',
		path: 'apps/web',
		port: 3001,
		dependencies,
		resolvedDeployTarget: 'dokploy',
	});

	it('should generate build args for dependencies', () => {
		const app = createApp(['api', 'auth']);
		const deployedUrls = {
			api: 'https://api.myapp.com',
			auth: 'https://auth.myapp.com',
		};

		const buildArgs = generatePublicUrlBuildArgs(app, deployedUrls);

		expect(buildArgs).toEqual([
			'NEXT_PUBLIC_API_URL=https://api.myapp.com',
			'NEXT_PUBLIC_AUTH_URL=https://auth.myapp.com',
		]);
	});

	it('should skip missing dependencies', () => {
		const app = createApp(['api', 'auth', 'missing']);
		const deployedUrls = {
			api: 'https://api.myapp.com',
			// auth and missing are not deployed yet
		};

		const buildArgs = generatePublicUrlBuildArgs(app, deployedUrls);

		expect(buildArgs).toEqual(['NEXT_PUBLIC_API_URL=https://api.myapp.com']);
	});

	it('should return empty array when no dependencies', () => {
		const app = createApp([]);
		const deployedUrls = { api: 'https://api.myapp.com' };

		const buildArgs = generatePublicUrlBuildArgs(app, deployedUrls);

		expect(buildArgs).toEqual([]);
	});

	it('should handle uppercase conversion correctly', () => {
		const app = createApp(['my-api', 'auth-service']);
		const deployedUrls = {
			'my-api': 'https://my-api.myapp.com',
			'auth-service': 'https://auth-service.myapp.com',
		};

		const buildArgs = generatePublicUrlBuildArgs(app, deployedUrls);

		expect(buildArgs).toEqual([
			'NEXT_PUBLIC_MY-API_URL=https://my-api.myapp.com',
			'NEXT_PUBLIC_AUTH-SERVICE_URL=https://auth-service.myapp.com',
		]);
	});
});

describe('getPublicUrlArgNames', () => {
	const createApp = (dependencies: string[]): NormalizedAppConfig => ({
		type: 'frontend',
		path: 'apps/web',
		port: 3001,
		dependencies,
		resolvedDeployTarget: 'dokploy',
	});

	it('should return arg names for dependencies', () => {
		const app = createApp(['api', 'auth']);
		const argNames = getPublicUrlArgNames(app);
		expect(argNames).toEqual(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_AUTH_URL']);
	});

	it('should return empty array when no dependencies', () => {
		const app = createApp([]);
		const argNames = getPublicUrlArgNames(app);
		expect(argNames).toEqual([]);
	});
});
