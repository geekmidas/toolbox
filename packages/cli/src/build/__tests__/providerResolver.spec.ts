import { describe, expect, it } from 'vitest';
import type { BuildOptions, GkmConfig, ProvidersConfig } from '../../types';
import {
	getAWSServiceConfig,
	getServerConfig,
	resolveProviders,
} from '../providerResolver';

const config = (providers?: ProvidersConfig) =>
	({
		stages: { local: 'dev', deployed: ['prod'] },
		...(providers ? { providers } : {}),
	}) as GkmConfig;

const resolve = (providers?: ProvidersConfig, options: BuildOptions = {}) =>
	resolveProviders(config(providers), options);

describe('resolveProviders', () => {
	it('builds API Gateway v2 and Lambda when nothing is configured', () => {
		expect(resolve()).toEqual({
			providers: ['aws-apigatewayv2', 'aws-lambda'],
			enableOpenApi: false,
		});
	});

	it('passes a legacy --providers list straight through', () => {
		expect(
			resolve(
				{ server: true },
				{ providers: ['aws-apigatewayv1'], enableOpenApi: true },
			),
		).toEqual({ providers: ['aws-apigatewayv1'], enableOpenApi: true });
	});

	describe('--provider aws', () => {
		it('defaults to API Gateway v2 and Lambda', () => {
			expect(resolve(undefined, { provider: 'aws' }).providers).toEqual([
				'aws-apigatewayv2',
				'aws-lambda',
			]);
		});

		it('builds only the gateways that are enabled', () => {
			expect(
				resolve(
					{ aws: { apiGateway: { v1: true, v2: false } } },
					{ provider: 'aws' },
				).providers,
			).toEqual(['aws-apigatewayv1', 'aws-lambda']);
		});

		it('treats an object without enabled: false as enabled', () => {
			expect(
				resolve(
					{
						aws: {
							apiGateway: { v1: {}, v2: { enabled: false } },
							lambda: { functions: { enabled: false }, crons: false },
						},
					},
					{ provider: 'aws' },
				).providers,
			).toEqual(['aws-apigatewayv1']);
		});

		it('builds Lambda when either functions or crons are on', () => {
			expect(
				resolve(
					{ aws: { lambda: { crons: true } } },
					{ provider: 'aws' },
				).providers,
			).toEqual(['aws-apigatewayv2', 'aws-lambda']);
		});

		it('keeps --enable-openapi from the command line', () => {
			expect(
				resolve(undefined, { provider: 'aws', enableOpenApi: true })
					.enableOpenApi,
			).toBe(true);
		});
	});

	describe('--provider server', () => {
		it('builds the server without OpenAPI by default', () => {
			expect(resolve({ server: true }, { provider: 'server' })).toEqual({
				providers: ['server'],
				enableOpenApi: false,
			});
		});

		it("takes OpenAPI from the server's own config", () => {
			expect(
				resolve({ server: { enableOpenApi: true } }, { provider: 'server' }),
			).toEqual({ providers: ['server'], enableOpenApi: true });
		});
	});

	describe('with no --provider, every configured provider', () => {
		it('builds AWS and the server together, without duplicates', () => {
			expect(
				resolve({
					aws: { apiGateway: { v2: true } },
					server: { enableOpenApi: true },
				}),
			).toEqual({
				providers: ['aws-apigatewayv2', 'aws-lambda', 'server'],
				enableOpenApi: true,
			});
		});

		it('skips a server that is switched off', () => {
			expect(resolve({ server: false }).providers).toEqual([]);
			expect(resolve({ server: { enabled: false } }).providers).toEqual([]);
		});

		it('builds a server given as true, without OpenAPI', () => {
			expect(resolve({ server: true })).toEqual({
				providers: ['server'],
				enableOpenApi: false,
			});
		});
	});
});

describe('getAWSServiceConfig', () => {
	const aws = config({
		aws: {
			apiGateway: { v1: { enabled: true }, v2: true },
			lambda: { functions: { enabled: false }, crons: true },
		},
	});

	it('returns the object form of a service config', () => {
		expect(getAWSServiceConfig(aws, 'apiGateway', 'v1')).toEqual({
			enabled: true,
		});
		expect(getAWSServiceConfig(aws, 'lambda', 'functions')).toEqual({
			enabled: false,
		});
	});

	it('returns nothing for a boolean, a missing sub-service, or no AWS', () => {
		expect(getAWSServiceConfig(aws, 'apiGateway', 'v2')).toBeUndefined();
		expect(getAWSServiceConfig(aws, 'lambda', 'crons')).toBeUndefined();
		expect(getAWSServiceConfig(aws, 'apiGateway')).toBeUndefined();
		expect(getAWSServiceConfig(aws, 'lambda')).toBeUndefined();
		expect(getAWSServiceConfig(config(), 'lambda', 'crons')).toBeUndefined();
		expect(
			getAWSServiceConfig(config({ aws: {} }), 'apiGateway', 'v1'),
		).toBeUndefined();
	});
});

describe('getServerConfig', () => {
	it('returns the object form only', () => {
		expect(getServerConfig(config({ server: { port: 4000 } }))).toEqual({
			port: 4000,
		});
		expect(getServerConfig(config({ server: true }))).toBeUndefined();
		expect(getServerConfig(config())).toBeUndefined();
	});
});
