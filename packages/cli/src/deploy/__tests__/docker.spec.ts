import { describe, expect, it } from 'vitest';
import type { GkmConfig } from '../../types';
import {
	applicationName,
	getAppNameFromCwd,
	getAppNameFromPackageJson,
	getImageRef,
	resolveDockerConfig,
} from '../docker';

describe('getImageRef', () => {
	it('should return image with registry prefix', () => {
		const result = getImageRef('ghcr.io/myorg', 'myapp', 'v1.0.0');
		expect(result).toBe('ghcr.io/myorg/myapp:v1.0.0');
	});

	it('should return image without registry when undefined', () => {
		const result = getImageRef(undefined, 'myapp', 'v1.0.0');
		expect(result).toBe('myapp:v1.0.0');
	});

	it('should handle different tag formats', () => {
		expect(getImageRef('docker.io', 'app', 'latest')).toBe(
			'docker.io/app:latest',
		);
		expect(getImageRef('docker.io', 'app', 'sha-abc123')).toBe(
			'docker.io/app:sha-abc123',
		);
		expect(getImageRef('docker.io', 'app', '1.2.3-beta.1')).toBe(
			'docker.io/app:1.2.3-beta.1',
		);
	});

	it('should handle registry with port', () => {
		const result = getImageRef('localhost:5000', 'myapp', 'dev');
		expect(result).toBe('localhost:5000/myapp:dev');
	});

	it('should handle nested registry paths', () => {
		const result = getImageRef('gcr.io/my-project/images', 'api', 'prod');
		expect(result).toBe('gcr.io/my-project/images/api:prod');
	});
});

describe('getAppNameFromCwd', () => {
	it('should return app name from package.json in current directory', () => {
		// Tests run from the monorepo root, so cwd is the root directory
		const appName = getAppNameFromCwd();
		// The root package.json has name "@geekmidas/toolbox", so it should strip the scope
		expect(appName).toBe('toolbox');
	});
});

describe('getAppNameFromPackageJson', () => {
	it('should return app name from package.json adjacent to lockfile', () => {
		// This test runs in the toolbox monorepo, so it should find the root package.json
		const appName = getAppNameFromPackageJson();
		// The root package.json has name "@geekmidas/toolbox", so it should strip the scope
		expect(appName).toBe('toolbox');
	});
});

describe('resolveDockerConfig', () => {
	it('should fallback to package.json name when docker not configured', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.registry).toBeUndefined();
		// Should fallback to package.json name or 'app'
		expect(dockerConfig.imageName).toBeDefined();
	});

	it('should return registry from docker config', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
			docker: {
				registry: 'ghcr.io/myorg',
			},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.registry).toBe('ghcr.io/myorg');
	});

	it('should return imageName from docker config', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
			docker: {
				imageName: 'my-api',
			},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.imageName).toBe('my-api');
	});

	it('should return both registry and imageName', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
			docker: {
				registry: 'docker.io/company',
				imageName: 'backend-api',
			},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.registry).toBe('docker.io/company');
		expect(dockerConfig.imageName).toBe('backend-api');
	});

	it('should fallback to package.json name when docker object is empty', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			docker: {},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.registry).toBeUndefined();
		// Should fallback to package.json name or 'app'
		expect(dockerConfig.imageName).toBeDefined();
	});

	it('should prefer explicit imageName over package.json', () => {
		const config: GkmConfig = {
			routes: './src/endpoints',
			docker: {
				imageName: 'explicit-name',
			},
		};

		const dockerConfig = resolveDockerConfig(config);

		expect(dockerConfig.imageName).toBe('explicit-name');
	});
});

/**
 * The name in the config is the scope, exactly as it is in an SST config.
 *
 * `sst.config.ts` declares `name: 'kitchen-sink'` and builds every physical name
 * from `[stage, name]`. This is the same statement in the same place, so a
 * construct carries one name across providers rather than two that happen to
 * match — and the application beside a `production-kitchen-sink-database` is no
 * longer called something from a different scheme entirely.
 */
describe('the name that scopes a deploy', () => {
	const config = (name?: string): GkmConfig =>
		({
			name,
			routes: './src/endpoints',
			envParser: './src/env',
			logger: './src/logger',
		}) as GkmConfig;

	it('takes the project from the config, not the directory', () => {
		expect(resolveDockerConfig(config('acme'), 'production').projectName).toBe(
			'acme',
		);
	});

	it('scopes the application by stage, so two stages cannot collide', () => {
		// The bug this closes: the application name carried no stage, so
		// deploying `staging` into the same project matched the production
		// application by name and redeployed it.
		expect(applicationName('production', 'shop', 'api')).not.toBe(
			applicationName('staging', 'shop', 'api'),
		);
		expect(resolveDockerConfig(config('shop'), 'staging').appName).toContain(
			'staging',
		);
	});

	it('names an application the way it names a construct', () => {
		// The application beside `production-shop-database` is
		// `production-shop-api`, through the same `scopedName`. It used to be the
		// bare app key on the workspace path — a project holding an `api` and a
		// `web` that every stage would collide on.
		expect(applicationName('production', 'shop', 'api')).toBe(
			'production-shop-api',
		);
		expect(applicationName('production', 'shop', 'web')).toBe(
			'production-shop-web',
		);
	});

	it('does not repeat a project name the app already is', () => {
		// A project named for its one application would otherwise be
		// `production-shop-shop`.
		expect(applicationName('production', 'shop', 'shop')).toBe(
			'production-shop',
		);
	});

	it('leaves the image out of it, because an image has no stage', () => {
		// One image is deployed to several stages, and the registry path already
		// scopes it. It is also what somebody types after `docker pull`.
		const resolved = resolveDockerConfig(config('shop'), 'production');

		expect(resolved.imageName).not.toContain('production');
	});

	it('falls back to the package when the config names nothing', () => {
		// A fallback, not the source — which is what it used to be.
		expect(
			resolveDockerConfig(config(), 'production').projectName,
		).toBeTruthy();
	});
});
