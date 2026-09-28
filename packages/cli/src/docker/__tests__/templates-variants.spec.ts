import { describe, expect, it } from 'vitest';
import {
	generateBackendDockerfile,
	generateMultiStageDockerfile,
	generateNodeWebDockerfile,
	generateViteStaticDockerfile,
} from '../templates';

const app = {
	imageName: 'web',
	baseImage: 'node:22-alpine',
	port: 3000,
	appPath: 'apps/web',
	turboPackage: '@shop/web',
};

describe('Dockerfiles for npm', () => {
	// npm ships with node: no install step, and turbo runs through npx.
	it('installs nothing and prunes with npx in a turbo build', () => {
		const dockerfile = generateMultiStageDockerfile({
			...app,
			healthCheckPath: '/health',
			prebuilt: false,
			turbo: true,
			packageManager: 'npm',
		});

		expect(dockerfile).toContain('npx turbo');
		expect(dockerfile).not.toContain('corepack');
	});

	it('prunes the api package when no turbo package is named', () => {
		const dockerfile = generateMultiStageDockerfile({
			imageName: 'api',
			baseImage: 'node:22-alpine',
			port: 3000,
			healthCheckPath: '/health',
			prebuilt: false,
			turbo: true,
			packageManager: 'pnpm',
		});

		expect(dockerfile).toContain('prune api');
	});

	it('builds a backend app the same way', () => {
		const dockerfile = generateBackendDockerfile({
			...app,
			packageManager: 'npm',
			healthCheckPath: '/health',
		});

		expect(dockerfile).toContain('npx turbo');
		expect(dockerfile).not.toContain('corepack');
	});

	it('starts a Node web app with npm', () => {
		const dockerfile = generateNodeWebDockerfile({
			...app,
			packageManager: 'npm',
			publicUrlArgs: [],
		});

		expect(dockerfile).toContain('npx turbo');
		expect(dockerfile).toContain('npm start');
	});
});

describe('public URLs a frontend is built with', () => {
	it.each([
		['a Node web app', generateNodeWebDockerfile],
		['a static Vite site', generateViteStaticDockerfile],
	] as const)('become build args and env for %s', (_kind, generate) => {
		const dockerfile = generate({
			...app,
			packageManager: 'pnpm',
			publicUrlArgs: ['VITE_API_URL', 'VITE_AUTH_URL'],
		});

		expect(dockerfile).toContain('ARG VITE_API_URL=""');
		expect(dockerfile).toContain('ENV VITE_API_URL=$VITE_API_URL');
		expect(dockerfile).toContain('ARG VITE_AUTH_URL=""');
		expect(dockerfile).toContain('pnpm dlx turbo');
	});

	it('uses npx for turbo in a static Vite site on npm', () => {
		expect(
			generateViteStaticDockerfile({
				...app,
				packageManager: 'npm',
				publicUrlArgs: [],
			}),
		).toContain('npx turbo');
	});
});
