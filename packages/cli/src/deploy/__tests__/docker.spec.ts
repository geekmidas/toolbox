import { describe, expect, it } from 'vitest';
import { applicationName, getImageRef } from '../docker';

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

describe('the name that scopes a deploy', () => {
	it('scopes the application by stage, so two stages cannot collide', () => {
		// The bug this closes: the application name carried no stage, so
		// deploying `staging` into the same project matched the production
		// application by name and redeployed it.
		expect(applicationName('production', 'shop', 'api')).not.toBe(
			applicationName('staging', 'shop', 'api'),
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
});
