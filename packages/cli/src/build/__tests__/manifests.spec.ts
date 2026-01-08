import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect, vi } from 'vitest';
import type {
	CronInfo,
	FunctionInfo,
	RouteInfo,
	SubscriberInfo,
} from '../../types';
import { generateAwsManifest, generateServerManifest } from '../manifests';

describe('generateAwsManifest', () => {
	itWithDir('should generate AWS manifest with routes', async ({ dir }) => {
		const routes: RouteInfo[] = [
			{
				path: '/users',
				method: 'GET',
				handler: '.gkm/aws/getUsers.handler',
				authorizer: 'jwt',
			},
			{
				path: '/users',
				method: 'POST',
				handler: '.gkm/aws/createUser.handler',
				authorizer: 'jwt',
			},
		];

		await generateAwsManifest(dir, routes, [], [], []);

		const manifestPath = join(dir, 'manifest', 'aws.ts');
		const content = await readFile(manifestPath, 'utf-8');

		expect(content).toContain('export const manifest = {');
		expect(content).toContain('} as const;');
		expect(content).toContain('/users');
		expect(content).toContain('GET');
		expect(content).toContain('POST');
		expect(content).toContain('jwt');
	});

	itWithDir(
		'should filter out ALL method routes from AWS manifest',
		async ({ dir }) => {
			const routes: RouteInfo[] = [
				{
					path: '/users',
					method: 'GET',
					handler: '.gkm/aws/getUsers.handler',
					authorizer: 'jwt',
				},
				{
					path: '*',
					method: 'ALL',
					handler: '.gkm/server/app.ts',
					authorizer: 'none',
				},
			];

			await generateAwsManifest(dir, routes, [], [], []);

			const manifestPath = join(dir, 'manifest', 'aws.ts');
			const content = await readFile(manifestPath, 'utf-8');

			expect(content).toContain('/users');
			expect(content).toContain('GET');
			expect(content).not.toContain('"ALL"');
		},
	);

	itWithDir('should generate AWS manifest with functions', async ({ dir }) => {
		const functions: FunctionInfo[] = [
			{
				name: 'processData',
				handler: '.gkm/aws/processData.handler',
				timeout: 300,
				memorySize: 512,
				environment: ['DATABASE_URL'],
			},
		];

		await generateAwsManifest(dir, [], functions, [], []);

		const manifestPath = join(dir, 'manifest', 'aws.ts');
		const content = await readFile(manifestPath, 'utf-8');

		expect(content).toContain('processData');
		expect(content).toContain('300');
		expect(content).toContain('512');
		expect(content).toContain('DATABASE_URL');
	});

	itWithDir('should generate AWS manifest with crons', async ({ dir }) => {
		const crons: CronInfo[] = [
			{
				name: 'dailyCleanup',
				handler: '.gkm/aws/dailyCleanup.handler',
				schedule: 'rate(1 day)',
				timeout: 300,
				memorySize: 256,
				environment: [],
			},
		];

		await generateAwsManifest(dir, [], [], crons, []);

		const manifestPath = join(dir, 'manifest', 'aws.ts');
		const content = await readFile(manifestPath, 'utf-8');

		expect(content).toContain('dailyCleanup');
		expect(content).toContain('rate(1 day)');
	});

	itWithDir(
		'should generate AWS manifest with subscribers',
		async ({ dir }) => {
			const subscribers: SubscriberInfo[] = [
				{
					name: 'orderHandler',
					handler: '.gkm/aws/orderHandler.handler',
					subscribedEvents: ['order.created', 'order.updated'],
					timeout: 30,
					memorySize: 256,
					environment: [],
				},
			];

			await generateAwsManifest(dir, [], [], [], subscribers);

			const manifestPath = join(dir, 'manifest', 'aws.ts');
			const content = await readFile(manifestPath, 'utf-8');

			expect(content).toContain('orderHandler');
			expect(content).toContain('order.created');
			expect(content).toContain('order.updated');
		},
	);

	itWithDir('should export derived types', async ({ dir }) => {
		await generateAwsManifest(dir, [], [], [], []);

		const manifestPath = join(dir, 'manifest', 'aws.ts');
		const content = await readFile(manifestPath, 'utf-8');

		expect(content).toContain('export type Route =');
		expect(content).toContain('export type Function =');
		expect(content).toContain('export type Cron =');
		expect(content).toContain('export type Subscriber =');
		expect(content).toContain('export type Authorizer =');
		expect(content).toContain('export type HttpMethod =');
		expect(content).toContain('export type RoutePath =');
	});

	itWithDir('should log manifest generation info', async ({ dir }) => {
		const logSpy = vi.spyOn(console, 'log');

		const routes: RouteInfo[] = [
			{
				path: '/users',
				method: 'GET',
				handler: '.gkm/aws/getUsers.handler',
				authorizer: 'jwt',
			},
		];

		await generateAwsManifest(dir, routes, [], [], []);

		expect(logSpy).toHaveBeenCalledWith(
			'Generated AWS manifest with 1 routes, 0 functions, 0 crons, 0 subscribers',
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Manifest:'));

		logSpy.mockRestore();
	});
});

describe('generateServerManifest', () => {
	itWithDir(
		'should generate server manifest with app info',
		async ({ dir }) => {
			const appInfo = {
				handler: '.gkm/server/app.ts',
				endpoints: '.gkm/server/endpoints.ts',
			};

			await generateServerManifest(dir, appInfo, [], []);

			const manifestPath = join(dir, 'manifest', 'server.ts');
			const content = await readFile(manifestPath, 'utf-8');

			expect(content).toContain('export const manifest = {');
			expect(content).toContain('} as const;');
			expect(content).toContain('app:');
			expect(content).toContain('.gkm/server/app.ts');
			expect(content).toContain('.gkm/server/endpoints.ts');
		},
	);

	itWithDir(
		'should generate server manifest with route metadata',
		async ({ dir }) => {
			const appInfo = {
				handler: '.gkm/server/app.ts',
				endpoints: '.gkm/server/endpoints.ts',
			};

			const routes: RouteInfo[] = [
				{
					path: '/users',
					method: 'GET',
					handler: '', // Not used for server
					authorizer: 'jwt',
				},
				{
					path: '/posts',
					method: 'POST',
					handler: '',
					authorizer: 'apiKey',
				},
			];

			await generateServerManifest(dir, appInfo, routes, []);

			const manifestPath = join(dir, 'manifest', 'server.ts');
			const content = await readFile(manifestPath, 'utf-8');

			expect(content).toContain('/users');
			expect(content).toContain('/posts');
			expect(content).toContain('GET');
			expect(content).toContain('POST');
			expect(content).toContain('jwt');
			expect(content).toContain('apiKey');
		},
	);

	itWithDir(
		'should filter out ALL method routes from server manifest',
		async ({ dir }) => {
			const appInfo = {
				handler: '.gkm/server/app.ts',
				endpoints: '.gkm/server/endpoints.ts',
			};

			const routes: RouteInfo[] = [
				{
					path: '/users',
					method: 'GET',
					handler: '',
					authorizer: 'jwt',
				},
				{
					path: '*',
					method: 'ALL',
					handler: '',
					authorizer: 'none',
				},
			];

			await generateServerManifest(dir, appInfo, routes, []);

			const manifestPath = join(dir, 'manifest', 'server.ts');
			const content = await readFile(manifestPath, 'utf-8');

			expect(content).toContain('/users');
			expect(content).not.toContain('"ALL"');
		},
	);

	itWithDir(
		'should generate server manifest with subscribers',
		async ({ dir }) => {
			const appInfo = {
				handler: '.gkm/server/app.ts',
				endpoints: '.gkm/server/endpoints.ts',
			};

			const subscribers: SubscriberInfo[] = [
				{
					name: 'orderHandler',
					handler: '.gkm/server/orderHandler.ts',
					subscribedEvents: ['order.created'],
					timeout: 30,
					memorySize: 256,
					environment: [],
				},
			];

			await generateServerManifest(dir, appInfo, [], subscribers);

			const manifestPath = join(dir, 'manifest', 'server.ts');
			const content = await readFile(manifestPath, 'utf-8');

			// Server manifest only includes name and events for subscribers
			expect(content).toContain('orderHandler');
			expect(content).toContain('order.created');
			// Should not include handler path in server manifest subscribers
			expect(content).not.toContain('.gkm/server/orderHandler.ts');
		},
	);

	itWithDir('should export derived types for server', async ({ dir }) => {
		const appInfo = {
			handler: '.gkm/server/app.ts',
			endpoints: '.gkm/server/endpoints.ts',
		};

		await generateServerManifest(dir, appInfo, [], []);

		const manifestPath = join(dir, 'manifest', 'server.ts');
		const content = await readFile(manifestPath, 'utf-8');

		expect(content).toContain('export type Route =');
		expect(content).toContain('export type Subscriber =');
		expect(content).toContain('export type Authorizer =');
		expect(content).toContain('export type HttpMethod =');
		expect(content).toContain('export type RoutePath =');
	});

	itWithDir('should log manifest generation info', async ({ dir }) => {
		const logSpy = vi.spyOn(console, 'log');

		const appInfo = {
			handler: '.gkm/server/app.ts',
			endpoints: '.gkm/server/endpoints.ts',
		};

		const routes: RouteInfo[] = [
			{
				path: '/users',
				method: 'GET',
				handler: '',
				authorizer: 'jwt',
			},
		];

		await generateServerManifest(dir, appInfo, routes, []);

		expect(logSpy).toHaveBeenCalledWith(
			'Generated server manifest with 1 routes, 0 subscribers',
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Manifest:'));

		logSpy.mockRestore();
	});
});
