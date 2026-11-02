import { resolveEnvKeys } from '@geekmidas/envkit/sst';
import {
	type ConstructManifest,
	parseApiGatewayWebSocketUrl,
	providedKeyFor,
} from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { RestApiSurface } from '../aws/RestApiSurface';
import {
	regionOfEndpoint,
	routeSelectionExpression,
	type WebSocketApiSurface,
} from '../aws/WebSocketApiSurface';
import {
	assertProvides,
	describeRoutes,
	mountWebSocketRoutes,
	type ProvisionedManifest,
	provisionerFor,
} from '../fromManifest';

const stack = {} as never;

const SURFACE_KEYS = [
	'REALTIME_URL',
	'REALTIME_TRUSTED_ORIGINS',
	'REALTIME_PUBLISHER_CONNECTION_STRING',
];

const manifest = {
	Realtime: {
		kind: 'websocket-api',
		id: 'Realtime',
		path: 'apps/realtime',
		discriminator: 'type',
		auth: { target: 'Auth', kind: 'rest-api' },
		routes: [
			{
				id: 'Realtime$connect',
				action: '$connect',
				handler: 'apps/realtime/.gkm/aws/websocket/connect.handler',
				dependencies: [],
			},
			{
				id: 'Realtimechat.send',
				action: 'chat.send',
				handler: 'apps/realtime/.gkm/aws/websocket/route-chat_send.handler',
				dependencies: [{ target: 'Api', kind: 'rest-api' }],
			},
		],
		provides: SURFACE_KEYS,
	},
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [],
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
	},
	Auth: {
		kind: 'rest-api',
		id: 'Auth',
		path: 'apps/auth',
		endpoints: [],
		provides: ['AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'AUTH_COOKIE_DOMAIN'],
	},
} as const satisfies ConstructManifest;

function provision(): ProvisionedManifest {
	const context = { manifest, provisioned: {}, bootstraps: new Map() };
	return {
		Realtime: provisionerFor('websocket-api')(
			stack,
			manifest.Realtime,
			{},
			context,
		),
		Api: new RestApiSurface(stack, 'Api'),
		Auth: new RestApiSurface(stack, 'Auth'),
	} as ProvisionedManifest;
}

describe('WebSocketApiSurface', () => {
	it('provides the keys a websocket-api declares', () => {
		const surface = provision().Realtime!;

		expect(() =>
			assertProvides(
				'Realtime',
				manifest.Realtime.provides,
				Object.keys(surface.provides()).map((role) =>
					providedKeyFor('Realtime', 'websocket-api', role),
				),
			),
		).not.toThrow();
	});

	it('resolves to the same keys a linked function reads', () => {
		const surface = provision().Realtime!;

		expect(
			[...resolveEnvKeys({ Realtime: { type: surface._type } })].sort(),
		).toEqual([...SURFACE_KEYS].sort());
	});

	it('hands its publisher the management API and its own connection table', () => {
		const surface = provision().Realtime as unknown as WebSocketApiSurface;

		expect(
			parseApiGatewayWebSocketUrl(
				surface.provides().publisherConnectionString as string,
			),
		).toEqual({
			region: 'stub-region',
			endpoint:
				'https://Realtime.execute-api.stub-region.amazonaws.com/$default',
			table: 'RealtimeConnections',
		});
	});

	it('grants a linked function the management API and the table, with the keys', () => {
		const surface = provision().Realtime as unknown as WebSocketApiSurface;
		const link = surface.getSSTLink();

		expect(link.include).toEqual([
			{ permission: { actions: ['execute-api:ManageConnections'] } },
			{ permission: { actions: ['dynamodb:*'] } },
		]);
		expect(link.properties).toMatchObject({
			url: 'wss://Realtime.execute-api.stub-region.amazonaws.com/$default',
		});
	});

	it('routes on the key its frames name their action under', () => {
		const surface = provision().Realtime as unknown as {
			args: { transform: { api: (api: object) => void } };
		};
		const api: { routeSelectionExpression?: string } = {};

		surface.args.transform.api(api);

		expect(api.routeSelectionExpression).toBe('$request.body.type');
		expect(routeSelectionExpression()).toBe('$request.body.action');
	});
});

describe('mountWebSocketRoutes', () => {
	const mounted = () => {
		const provisioned = provision();
		mountWebSocketRoutes(manifest, provisioned);
		const surface = provisioned.Realtime as unknown as {
			routes: { key: string; handler: { handler: string; link: unknown[] } }[];
		};
		return { provisioned, routes: surface.routes };
	};

	it('mounts every route on its key, running the handler the build wrote', () => {
		expect(
			mounted().routes.map(({ key, handler }) => [key, handler.handler]),
		).toEqual([
			['$connect', 'apps/realtime/.gkm/aws/websocket/connect.handler'],
			['chat.send', 'apps/realtime/.gkm/aws/websocket/route-chat_send.handler'],
		]);
	});

	it('links a route to its surface and what it depends on, and nothing else', () => {
		const { provisioned, routes } = mounted();
		const send = routes.find((route) => route.key === 'chat.send')!;

		expect(send.handler.link).toEqual([provisioned.Realtime, provisioned.Api]);
	});

	it('links $connect to what authenticates the surface', () => {
		const { provisioned, routes } = mounted();
		const connect = routes.find((route) => route.key === '$connect')!;

		expect(connect.handler.link).toEqual([
			provisioned.Realtime,
			provisioned.Auth,
		]);
	});
});

describe('describeRoutes', () => {
	it('prints what each WebSocket route reaches', () => {
		expect(describeRoutes(manifest)).toEqual(
			expect.arrayContaining([
				'Realtime:',
				'  $connect → its connections',
				'  chat.send → Api (rest-api)',
				'  auth Auth ($connect verifies)',
			]),
		);
	});
});

describe('regionOfEndpoint', () => {
	it('reads the region out of a management endpoint', () => {
		expect(
			regionOfEndpoint('https://abc.execute-api.eu-west-1.amazonaws.com/prod'),
		).toBe('eu-west-1');
	});

	it('is undefined for a custom domain', () => {
		expect(regionOfEndpoint('https://ws.example.com')).toBeUndefined();
	});
});
