import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { Api, RoutesMissingEnvironment } from '../aws/Api';
import { type GkmLinkable, ResourceType } from '../Linkable';

/**
 * The HTTP API as data: what it asks SST to route, with which authorizer, and
 * which links each route gets. SST's `ApiGatewayV2` is a recording stub
 * (`test/sst-globals.ts`), so no resource is created.
 */

const stack = new App({
	name: 'shop',
	stage: 'prod',
	domain: 'shop.test',
	hostedZoneId: 'Z1',
	region: 'eu-west-1',
}).stack('api');

const db: GkmLinkable = { _id: 'db', _type: ResourceType.Postgres };

type Recorded = {
	args: Record<string, unknown>;
	routes: { key: string; handler: Record<string, unknown>; args: unknown }[];
	authorizers: Record<string, unknown>[];
};
const recorded = (api: Api) => api as unknown as Recorded;

describe('Api', () => {
	it('routes each entry to its handler, with only the links it needs', () => {
		const api = new Api(stack, 'Http', {
			root: 'apps/api',
			links: [db],
			environment: { FEATURE: 'on' },
			cors: { allowOrigins: ['https://shop.test'] },
			routes: [
				{
					method: 'GET',
					path: '/orders',
					handler: 'handlers/orders.handler',
					environment: ['DB_URL', 'FEATURE'],
				},
				{
					method: 'GET',
					path: '/health',
					handler: 'handlers/health.handler',
					runtime: 'nodejs22.x',
					timeout: '5 seconds',
					memory: '256 MB',
				},
			],
		});
		const { args, routes } = recorded(api);

		expect(api._type).toBe(ResourceType.ApiGatewayV2);
		// Native args pass straight through.
		expect(args).toEqual({ cors: { allowOrigins: ['https://shop.test'] } });
		expect(routes.map((r) => r.key)).toEqual(['GET /orders', 'GET /health']);

		const [orders, health] = routes;
		expect(orders!.handler).toMatchObject({
			handler: 'apps/api/handlers/orders.handler',
			runtime: 'nodejs24.x',
			link: [db],
			environment: expect.objectContaining({ STAGE: 'prod', FEATURE: 'on' }),
		});
		expect(orders!.args).toBeUndefined();
		// Least privilege: a route that names no link var gets no link.
		expect(health!.handler).toMatchObject({
			link: [],
			runtime: 'nodejs22.x',
			timeout: '5 seconds',
			memory: '256 MB',
		});
	});

	it('wires each route to the authorizer it names', () => {
		const lambda = { arn: 'arn:aws:lambda:eu-west-1:1:function:authz' };
		const api = new Api(stack, 'Http', {
			authorizers: {
				jwt: {
					issuer: 'https://id.shop.test',
					audiences: ['shop'],
					scopes: ['read'],
				},
				tenant: { handler: lambda as never, payload: '2.0' },
				key: { handler: 'handlers/key.handler' },
			},
			routes: [
				{ method: 'GET', path: '/a', handler: 'a.h', authorizer: 'jwt' },
				{
					method: 'GET',
					path: '/b',
					handler: 'b.h',
					authorizer: 'jwt',
					scopes: ['write'],
				},
				{ method: 'GET', path: '/c', handler: 'c.h', authorizer: 'tenant' },
				{ method: 'GET', path: '/d', handler: 'd.h', authorizer: 'iam' },
				{ method: 'GET', path: '/e', handler: 'e.h', authorizer: 'none' },
				{ method: 'GET', path: '/f', handler: 'f.h' },
			],
		} as never);
		const { routes, authorizers } = recorded(api);

		expect(authorizers).toEqual([
			{
				name: 'jwt',
				jwt: {
					issuer: 'https://id.shop.test',
					audiences: ['shop'],
					identitySource: undefined,
				},
			},
			{
				name: 'tenant',
				// A `Function` construct is passed as its ARN.
				lambda: {
					function: lambda.arn,
					identitySources: undefined,
					payload: '2.0',
				},
			},
			{
				name: 'key',
				lambda: {
					function: 'handlers/key.handler',
					identitySources: undefined,
					payload: undefined,
				},
			},
		]);
		expect(routes.map((r) => r.args)).toEqual([
			{ auth: { jwt: { authorizer: 'jwt-authorizer-id', scopes: ['read'] } } },
			// A route's own scopes override the authorizer's defaults.
			{ auth: { jwt: { authorizer: 'jwt-authorizer-id', scopes: ['write'] } } },
			{ auth: { lambda: 'tenant-authorizer-id' } },
			{ auth: { iam: true } },
			undefined,
			undefined,
		]);
	});

	it('fails the synth, naming every route whose variables no link provides', () => {
		const build = () =>
			new Api(stack, 'Http', {
				links: [db],
				routes: [
					{
						method: 'GET',
						path: '/ok',
						handler: 'ok.h',
						environment: ['DB_URL'],
					},
					{
						method: 'POST',
						path: '/pay',
						handler: 'pay.h',
						environment: ['STRIPE_KEY'],
					},
					{
						method: 'GET',
						path: '/mail',
						handler: 'mail.h',
						environment: ['SMTP_URL'],
					},
				],
			});

		expect(build).toThrow(RoutesMissingEnvironment);
		expect(build).toThrow(/Http POST \/pay[\s\S]*STRIPE_KEY/);
		expect(build).toThrow(/Http GET \/mail[\s\S]*SMTP_URL/);
	});

	it('leaves a route public rather than half-wired when its authorizer was never declared', () => {
		const api = new Api(stack, 'Http', {
			routes: [
				{ method: 'GET', path: '/ghost', handler: 'g.h', authorizer: 'ghost' },
			],
		} as never);

		expect(recorded(api).routes[0]!.args).toBeUndefined();
		expect(recorded(api).authorizers).toEqual([]);
	});
});
