// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import {
	ApiGatewayV2Client,
	CreateApiCommand,
	CreateIntegrationCommand,
	CreateRouteCommand,
	CreateStageCommand,
	DeleteApiCommand,
} from '@aws-sdk/client-apigatewayv2';
import {
	CreateTableCommand,
	DeleteTableCommand,
	DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { EnvironmentParser } from '@geekmidas/envkit';
import { UnauthorizedError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { apiGatewayWebSocketUrl } from '@geekmidas/manifest';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { WebSocketApi } from '../../websocket-api';
import {
	AmazonApiGatewayWebSocket,
	ApiGatewaySink,
	DynamoConnectionTable,
} from '../apigateway';

/**
 * The adaptor behind a real API Gateway WebSocket API, on floci — the AWS
 * emulator the test stack runs. Clients are real sockets on floci's data plane;
 * each route's integration is an HTTP proxy to a server in this process that
 * hands the proxy event to the adaptor's handler, exactly as a Lambda would be
 * handed it. Replies, broadcasts and closes go out through floci's own
 * `@connections` API, and the connection table is real DynamoDB.
 */

const region = 'us-east-1';
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
const STAGE = 'test';

const dynamo = new DynamoDBClient({
	region,
	endpoint: LOCALSTACK_URL,
	credentials,
});
const gateway = new ApiGatewayV2Client({
	region,
	endpoint: LOCALSTACK_URL,
	credentials,
});

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
	fatal() {},
	trace() {},
	child: () => silent,
} as unknown as Logger;

const realtime = new WebSocketApi('Realtime', {
	path: 'apps/realtime',
	messages: {
		'chat.said': z.object({ from: z.string(), text: z.string() }),
	},
	logger: silent,
});

const disconnected: unknown[] = [];

const routes = {
	connect: realtime.connect().handle(({ query }) => {
		const user = query.get('user');
		if (!user) throw new UnauthorizedError('Sign in first');
		return { user };
	}),
	say: realtime
		.route('chat.say')
		.body(z.object({ text: z.string() }))
		.handle(async ({ body, connection, sockets }) => {
			await sockets.broadcast(
				'chat.said',
				{ from: String(connection.data.user), text: body.text },
				{ except: [connection.id] },
			);
			return { heard: body.text, by: connection.data.user };
		}),
	disconnect: realtime.disconnect().handle(({ connection, code }) => {
		disconnected.push({ id: connection.id, data: connection.data, code });
	}),
};

/** The Lambda the integrations currently reach; each test deploys its own. */
let lambda: AmazonApiGatewayWebSocket<any>;
let integration: Server;
let apiId: string;
/** The surface's `@connections` endpoint on floci. */
let management: string;
let sockets: string;

/**
 * A WebSocket API as a deploy shapes it: `$connect`, `$disconnect` and
 * `$default`, every one integrated with the surface's handler.
 */
async function deployApi(target: string): Promise<string> {
	const api = await gateway.send(
		new CreateApiCommand({
			Name: `gkm-realtime-${crypto.randomUUID()}`,
			ProtocolType: 'WEBSOCKET',
			RouteSelectionExpression: '$request.body.action',
		}),
	);
	for (const route of ['$connect', '$disconnect', '$default']) {
		const { IntegrationId } = await gateway.send(
			new CreateIntegrationCommand({
				ApiId: api.ApiId,
				IntegrationType: 'HTTP_PROXY',
				IntegrationMethod: 'POST',
				IntegrationUri: target,
			}),
		);
		await gateway.send(
			new CreateRouteCommand({
				ApiId: api.ApiId,
				RouteKey: route,
				Target: `integrations/${IntegrationId}`,
			}),
		);
	}
	await gateway.send(
		new CreateStageCommand({
			ApiId: api.ApiId,
			StageName: STAGE,
			AutoDeploy: true,
		}),
	);
	return api.ApiId!;
}

beforeAll(async () => {
	// What the adaptor's own clients read — the default chain, as on a Lambda.
	vi.stubEnv('AWS_ACCESS_KEY_ID', credentials.accessKeyId);
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', credentials.secretAccessKey);

	integration = createServer(async (req, res) => {
		let body = '';
		for await (const chunk of req) body += chunk;
		const result = await lambda.handler(JSON.parse(body));
		res.writeHead(result.statusCode, { 'content-type': 'application/json' });
		res.end(result.body ?? '');
	});
	await new Promise<void>((resolve) => integration.listen(0, resolve));
	const { port } = integration.address() as AddressInfo;

	// floci runs in a container; the host is host.docker.internal from there.
	apiId = await deployApi(`http://host.docker.internal:${port}/`);
	management = `${LOCALSTACK_URL}/execute-api/${apiId}/${STAGE}`;
	sockets = `${LOCALSTACK_URL.replace(/^http/, 'ws')}/ws/${apiId}/${STAGE}`;
});

const tables: string[] = [];
const clients: WebSocket[] = [];

afterEach(() => {
	for (const client of clients.splice(0)) client.terminate();
});

afterAll(async () => {
	vi.unstubAllEnvs();
	await new Promise((resolve) => integration.close(resolve));
	await gateway.send(new DeleteApiCommand({ ApiId: apiId }));
	for (const TableName of tables) {
		await dynamo.send(new DeleteTableCommand({ TableName }));
	}
});

async function createTable(): Promise<string> {
	const name = `ws-connections-${crypto.randomUUID()}`;
	await dynamo.send(
		new CreateTableCommand({
			TableName: name,
			AttributeDefinitions: [
				{ AttributeName: 'connectionId', AttributeType: 'S' },
			],
			KeySchema: [{ AttributeName: 'connectionId', KeyType: 'HASH' }],
			BillingMode: 'PAY_PER_REQUEST',
		}),
	);
	tables.push(name);
	return name;
}

/** The surface's keys, as a linked Lambda reads them. */
function envFor(table: string) {
	return new EnvironmentParser({
		REALTIME_PUBLISHER_CONNECTION_STRING: apiGatewayWebSocketUrl({
			region,
			endpoint: management,
			table,
			tableEndpoint: LOCALSTACK_URL,
		}),
		REALTIME_TRUSTED_ORIGINS: 'https://app.example.com',
		REALTIME_URL: 'wss://realtime.example.com',
	});
}

/** A socket on floci's data plane, with every frame it was sent. */
interface Client {
	socket: WebSocket;
	received: unknown[];
	closed: Promise<number>;
}

async function connect(
	options: { user?: string; origin?: string } = {},
): Promise<Client> {
	const query = options.user ? `?user=${options.user}` : '';
	const socket = new WebSocket(`${sockets}${query}`, {
		...(options.origin ? { origin: options.origin } : {}),
	});
	clients.push(socket);
	const received: unknown[] = [];
	socket.on('message', (frame) => received.push(JSON.parse(String(frame))));
	const closed = new Promise<number>((resolve) =>
		socket.on('close', (code) => resolve(code)),
	);
	await new Promise<void>((resolve, reject) => {
		socket.once('open', () => resolve());
		socket.once('unexpected-response', (_, response) =>
			reject(new HandshakeRefused(response.statusCode ?? 0)),
		);
		socket.once('error', reject);
	});
	return { socket, received, closed };
}

class HandshakeRefused extends Error {
	constructor(readonly status: number) {
		super(`The gateway refused the handshake with ${status}.`);
		this.name = 'HandshakeRefused';
	}
}

class NotConnected extends Error {
	constructor(readonly user: string) {
		super(`No row in the connection table is ${user}'s.`);
		this.name = 'NotConnected';
	}
}

const say = (client: Client, text: unknown) =>
	client.socket.send(JSON.stringify({ action: 'chat.say', data: { text } }));

describe('AmazonApiGatewayWebSocket behind API Gateway', () => {
	let table: string;
	let rows: DynamoConnectionTable;

	/** The connection id API Gateway gave a user's socket. */
	async function idOf(user: string): Promise<string> {
		for (const id of await rows.ids()) {
			if ((await rows.get(id))?.data.user === user) return id;
		}
		throw new NotConnected(user);
	}

	beforeEach(async () => {
		table = await createTable();
		// One Lambda serving every route, as a test can; a build writes one
		// per route, each handed only its own.
		lambda = new AmazonApiGatewayWebSocket(realtime, {
			envParser: envFor(table),
			modules: [routes],
		});
		rows = new DynamoConnectionTable(table, dynamo);
	});

	it('keeps what $connect returned, and replies to the caller with it', async () => {
		const ada = await connect({ user: 'ada' });
		const id = await idOf('ada');
		expect(await rows.get(id)).toEqual({ id, data: { user: 'ada' } });

		say(ada, 'hi');

		await vi.waitFor(() =>
			expect(ada.received).toEqual([
				{ action: 'chat.say', data: { heard: 'hi', by: 'ada' } },
			]),
		);
	});

	it('refuses a handshake its connect handler threw for, and keeps no row', async () => {
		// The handler answers 401; what the client sees is the gateway's own
		// refusal of the upgrade.
		await expect(connect()).rejects.toBeInstanceOf(HandshakeRefused);
		expect(await rows.ids()).toEqual([]);
	});

	it('refuses an origin the surface does not trust', async () => {
		await expect(
			connect({ user: 'ada', origin: 'https://evil.example.com' }),
		).rejects.toBeInstanceOf(HandshakeRefused);
		expect(await rows.ids()).toEqual([]);
	});

	it('trusts its callers and its own address', async () => {
		await connect({ user: 'ada', origin: 'https://app.example.com' });
		await connect({ user: 'grace', origin: 'https://realtime.example.com' });

		expect(await rows.ids()).toHaveLength(2);
	});

	it('broadcasts to every other socket, and drops a row the gateway has gone', async () => {
		const ada = await connect({ user: 'ada' });
		const grace = await connect({ user: 'grace' });
		// A row whose socket API Gateway no longer has: it answers 410.
		await rows.put({ id: 'gone-1', data: { user: 'linus' } });

		say(ada, 'hello');

		await vi.waitFor(() => {
			expect(grace.received).toEqual([
				{ action: 'chat.said', data: { from: 'ada', text: 'hello' } },
			]);
			// `except` holds: the sender gets its reply, not the broadcast.
			expect(ada.received).toEqual([
				{ action: 'chat.say', data: { heard: 'hello', by: 'ada' } },
			]);
		});
		// 410 is not an error to the sender, and the row is gone with it.
		expect((await rows.ids()).sort()).toEqual(
			[await idOf('ada'), await idOf('grace')].sort(),
		);
	});

	it('answers a frame its route refuses with an $error to the caller', async () => {
		const ada = await connect({ user: 'ada' });

		say(ada, 42);

		await vi.waitFor(() =>
			expect(ada.received).toEqual([
				{
					action: '$error',
					data: expect.objectContaining({ message: 'The frame was invalid.' }),
				},
			]),
		);
	});

	it('runs $disconnect with the connection’s data when the socket goes, and deletes its row', async () => {
		const ada = await connect({ user: 'ada' });
		const id = await idOf('ada');

		ada.socket.close(1000);

		await vi.waitFor(async () => {
			expect(disconnected).toContainEqual(
				expect.objectContaining({ id, data: { user: 'ada' } }),
			);
			expect(await rows.get(id)).toBeUndefined();
		});
	});

	it('reaches a socket from another Lambda through services.<surface>', async () => {
		const ada = await connect({ user: 'ada' });
		const grace = await connect({ user: 'grace' });

		// An endpoint that `.dependsOn([realtime])`, linked to the surface.
		const publisher = await realtime.service.register({
			envParser: envFor(table),
		} as never);
		await publisher.send(await idOf('grace'), 'chat.said', {
			from: 'system',
			text: 'hi',
		});
		await publisher.close(await idOf('ada'));

		await vi.waitFor(() =>
			expect(grace.received).toEqual([
				{ action: 'chat.said', data: { from: 'system', text: 'hi' } },
			]),
		);
		expect(await ada.closed).toBe(1000);
		await vi.waitFor(async () =>
			expect(await rows.ids()).toEqual([await idOf('grace')]),
		);
	});
});

describe('ApiGatewaySink, given its clients', () => {
	it('posts to and closes the sockets in the table it was given', async () => {
		const table = await createTable();
		const rows = new DynamoConnectionTable(table, dynamo);
		const sink = new ApiGatewaySink(
			new ApiGatewayManagementApiClient({
				region,
				endpoint: management,
				credentials,
			}),
			rows,
		);
		lambda = new AmazonApiGatewayWebSocket(realtime, {
			envParser: envFor(table),
			modules: [routes],
		});
		const ada = await connect({ user: 'ada' });
		const [id] = await rows.ids();

		await sink.broadcast(
			JSON.stringify({ action: 'chat.said', data: { from: 'x', text: 'y' } }),
		);
		await vi.waitFor(() =>
			expect(ada.received).toEqual([
				{ action: 'chat.said', data: { from: 'x', text: 'y' } },
			]),
		);

		await sink.close([id!], 1000, '');
		expect(await ada.closed).toBe(1000);
	});
});

describe('DynamoConnectionTable', () => {
	it('leaves out a row whose time has passed, before DynamoDB deletes it', async () => {
		const table = await createTable();
		const rows = new DynamoConnectionTable(table, dynamo);
		const expiring = new DynamoConnectionTable(table, dynamo, { ttl: -1 });
		await expiring.put({ id: 'old', data: {} });
		await rows.put({ id: 'new', data: {} });

		expect(await rows.ids()).toEqual(['new']);
		expect(await rows.get('old')).toBeUndefined();
	});
});
