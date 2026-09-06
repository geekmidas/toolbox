import { describe, expect, it } from 'vitest';
import type { NormalizedAppConfig } from '../../workspace/types';
import {
	AmbiguousRootSite,
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
		const app = createApp({ type: 'web' });
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

describe('which site holds the base domain', () => {
	const app = (type: 'backend' | 'web', root?: boolean): NormalizedAppConfig =>
		({
			type,
			path: 'apps/test',
			port: 3000,
			dependencies: [],
			resolvedDeployTarget: 'dokploy',
			...(root ? { root: true } : {}),
		}) as NormalizedAppConfig;

	it('is never a backend', () => {
		const apps = { api: app('backend'), web: app('web') };

		expect(isMainFrontendApp('api', apps.api, apps)).toBe(false);
	});

	it('is the only site, when there is only one', () => {
		// Nothing has to be said for the case that cannot be ambiguous.
		const apps = { api: app('backend'), admin: app('web') };

		expect(isMainFrontendApp('admin', apps.admin, apps)).toBe(true);
	});

	it('is the one named `web`, because that convention is already relied on', () => {
		const apps = { api: app('backend'), web: app('web'), admin: app('web') };

		expect(isMainFrontendApp('web', apps.web, apps)).toBe(true);
		expect(isMainFrontendApp('admin', apps.admin, apps)).toBe(false);
	});

	it('is the one that declared itself root', () => {
		const apps = {
			api: app('backend'),
			console: app('web'),
			admin: app('web', true),
		};

		expect(isMainFrontendApp('admin', apps.admin, apps)).toBe(true);
		expect(isMainFrontendApp('console', apps.console, apps)).toBe(false);
	});

	it('does not depend on the order they were declared in', () => {
		// The bug this replaces: the rule took the *first* site it iterated, and
		// that object is built from the manifest, which is built in glob
		// traversal order — so renaming a file could move the production root
		// domain, with nothing reporting it.
		const forward = { admin: app('web', true), console: app('web') };
		const reversed = { console: app('web'), admin: app('web', true) };

		expect(isMainFrontendApp('admin', forward.admin, forward)).toBe(true);
		expect(isMainFrontendApp('admin', reversed.admin, reversed)).toBe(true);
	});

	it('refuses to guess when several sites could be it', () => {
		// The same shape as `CacheIsAmbiguous`: unambiguous with one and
		// arbitrary with two, so two is an error rather than a coin toss.
		const apps = { admin: app('web'), console: app('web') };

		expect(() => isMainFrontendApp('admin', apps.admin, apps)).toThrow(
			AmbiguousRootSite,
		);
	});

	it('refuses when more than one claims it', () => {
		const apps = { admin: app('web', true), console: app('web', true) };

		expect(() => isMainFrontendApp('admin', apps.admin, apps)).toThrow(
			AmbiguousRootSite,
		);
	});
});

describe('generatePublicUrlBuildArgs', () => {
	const createApp = (dependencies: string[]): NormalizedAppConfig => ({
		type: 'web',
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
		type: 'web',
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
