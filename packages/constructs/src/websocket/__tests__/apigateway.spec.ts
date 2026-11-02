// @vitest-environment node
import {
	CreateTableCommand,
	DeleteTableCommand,
	DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { EnvironmentParser } from '@geekmidas/envkit';
import { UnauthorizedError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { apiGatewayWebSocketUrl } from '@geekmidas/manifest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
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
import { z } from 'zod';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { WebSocketApi } from '../../websocket-api';
import {
	AmazonApiGatewayWebSocket,
	type ApiGatewayWebSocketEvent,
	DynamoConnectionTable,
} from '../apigateway';

/**
 * The connection table against floci, the AWS emulator the test stack runs,
 * so every read and write is a real DynamoDB call. The management API is the
 * gateway's own, which no emulator serves: it is answered by MSW, as a
 * third-party API is, and what was posted to each connection is recorded.
 */

const region = 'us-east-1';
const MANAGEMENT = 'https://abc123.execute-api.us-east-1.amazonaws.com/test';

const dynamo = new DynamoDBClient({
	region,
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
const tables: string[] = [];

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

/** What the management API was asked, by connection id. */
let posted: Map<string, unknown[]>;
let deleted: string[];
/** Connections the gateway answers 410 for. */
let gone: Set<string>;

const management = setupServer(
	http.post(`${MANAGEMENT}/@connections/:id`, async ({ params, request }) => {
		const id = decodeURIComponent(params.id as string);
		if (gone.has(id)) {
			return HttpResponse.json(
				{ message: 'Gone' },
				{ status: 410, headers: { 'x-amzn-ErrorType': 'GoneException' } },
			);
		}
		const list = posted.get(id) ?? [];
		list.push(JSON.parse(await request.text()));
		posted.set(id, list);
		return new HttpResponse(null, { status: 200 });
	}),
	http.delete(`${MANAGEMENT}/@connections/:id`, ({ params }) => {
		deleted.push(decodeURIComponent(params.id as string));
		return new HttpResponse(null, { status: 204 });
	}),
);

beforeAll(() => {
	// What the adaptor's own clients read — the default chain, as on a Lambda.
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	management.listen({ onUnhandledRequest: 'bypass' });
});

beforeEach(() => {
	posted = new Map();
	deleted = [];
	gone = new Set();
});

afterEach(() => management.resetHandlers());

afterAll(async () => {
	management.close();
	vi.unstubAllEnvs();
	for (const TableName of tables) {
		await dynamo.send(new DeleteTableCommand({ TableName }));
	}
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

/** The surface's keys, as a linked Lambda reads them. */
function envFor(table: string) {
	return new EnvironmentParser({
		REALTIME_PUBLISHER_CONNECTION_STRING: apiGatewayWebSocketUrl({
			region,
			endpoint: MANAGEMENT,
			table,
			tableEndpoint: LOCALSTACK_URL,
		}),
		REALTIME_TRUSTED_ORIGINS: 'https://app.example.com',
		REALTIME_URL: 'wss://realtime.example.com',
	});
}

const connectEvent = (
	connectionId: string,
	options: { user?: string; origin?: string } = {},
): ApiGatewayWebSocketEvent => ({
	requestContext: { connectionId, eventType: 'CONNECT', routeKey: '$connect' },
	headers: options.origin ? { Origin: options.origin } : {},
	queryStringParameters: options.user ? { user: options.user } : null,
});

const messageEvent = (
	connectionId: string,
	body: unknown,
): ApiGatewayWebSocketEvent => ({
	requestContext: { connectionId, eventType: 'MESSAGE', routeKey: 'chat.say' },
	body: JSON.stringify(body),
	isBase64Encoded: false,
});

const disconnectEvent = (connectionId: string): ApiGatewayWebSocketEvent => ({
	requestContext: {
		connectionId,
		eventType: 'DISCONNECT',
		routeKey: '$disconnect',
		disconnectStatusCode: 1001,
		disconnectReason: 'going away',
	},
});

describe('AmazonApiGatewayWebSocket', () => {
	let table: string;
	let lambda: AmazonApiGatewayWebSocket<any>;
	let rows: DynamoConnectionTable;

	beforeEach(async () => {
		table = await createTable();
		// One Lambda serving every route, as a test can; a build writes one
		// per route, each handed only its own.
		lambda = new AmazonApiGatewayWebSocket(realtime, {
			envParser: envFor(table),
			modules: [routes],
		});
		rows = new DynamoConnectionTable(table, {
			region,
			endpoint: LOCALSTACK_URL,
		});
	});

	it('keeps what $connect returned, and hands it to every later frame', async () => {
		expect(await lambda.handler(connectEvent('c1', { user: 'ada' }))).toEqual({
			statusCode: 200,
		});
		expect(await rows.get('c1')).toEqual({ id: 'c1', data: { user: 'ada' } });

		expect(
			await lambda.handler(
				messageEvent('c1', { action: 'chat.say', data: { text: 'hi' } }),
			),
		).toEqual({ statusCode: 200 });

		// The reply is posted to the caller, with the data its $connect kept.
		expect(posted.get('c1')).toEqual([
			{ action: 'chat.say', data: { heard: 'hi', by: 'ada' } },
		]);
	});

	it('refuses a handshake with the status its connect handler threw, and keeps no row', async () => {
		expect(await lambda.handler(connectEvent('c1'))).toMatchObject({
			statusCode: 401,
		});
		expect(await rows.get('c1')).toBeUndefined();
	});

	it('refuses an origin the surface does not trust', async () => {
		expect(
			await lambda.handler(
				connectEvent('c1', { user: 'ada', origin: 'https://evil.example.com' }),
			),
		).toMatchObject({ statusCode: 403 });
		expect(await rows.get('c1')).toBeUndefined();
	});

	it('trusts its callers and its own address', async () => {
		for (const origin of [
			'https://app.example.com',
			'https://realtime.example.com',
		]) {
			expect(
				await lambda.handler(connectEvent(origin, { user: 'ada', origin })),
			).toEqual({ statusCode: 200 });
		}
	});

	it('broadcasts to every connection in the table, dropping one that has gone', async () => {
		for (const [id, user] of [
			['c1', 'ada'],
			['c2', 'grace'],
			['c3', 'linus'],
		]) {
			await lambda.handler(connectEvent(id!, { user }));
		}
		gone.add('c3');

		await lambda.handler(
			messageEvent('c1', { action: 'chat.say', data: { text: 'hello' } }),
		);

		expect(posted.get('c2')).toEqual([
			{ action: 'chat.said', data: { from: 'ada', text: 'hello' } },
		]);
		// `except` holds: the sender gets its reply, not the broadcast.
		expect(posted.get('c1')).toEqual([
			{ action: 'chat.say', data: { heard: 'hello', by: 'ada' } },
		]);
		// 410 is not an error to the sender, and the row is gone with it.
		expect(posted.has('c3')).toBe(false);
		expect((await rows.ids()).sort()).toEqual(['c1', 'c2']);
	});

	it('answers a frame its route refuses with an $error to the caller', async () => {
		await lambda.handler(connectEvent('c1', { user: 'ada' }));

		await lambda.handler(
			messageEvent('c1', { action: 'chat.say', data: { text: 42 } }),
		);

		expect(posted.get('c1')).toEqual([
			{
				action: '$error',
				data: expect.objectContaining({ message: 'The frame was invalid.' }),
			},
		]);
	});

	it('runs $disconnect with the connection’s data and deletes its row', async () => {
		await lambda.handler(connectEvent('c9', { user: 'ada' }));

		expect(await lambda.handler(disconnectEvent('c9'))).toEqual({
			statusCode: 200,
		});

		expect(disconnected).toContainEqual({
			id: 'c9',
			data: { user: 'ada' },
			code: 1001,
		});
		expect(await rows.get('c9')).toBeUndefined();
	});

	it('reaches a socket from another Lambda through services.<surface>', async () => {
		await lambda.handler(connectEvent('c1', { user: 'ada' }));
		await lambda.handler(connectEvent('c2', { user: 'grace' }));

		// An endpoint that `.dependsOn([realtime])`, linked to the surface.
		const publisher = await realtime.service.register({
			envParser: envFor(table),
		} as never);
		await publisher.send('c2', 'chat.said', { from: 'system', text: 'hi' });
		await publisher.close('c1');

		expect(posted.get('c2')).toEqual([
			{ action: 'chat.said', data: { from: 'system', text: 'hi' } },
		]);
		expect(deleted).toEqual(['c1']);
		expect(await rows.ids()).toEqual(['c2']);
	});

	it('leaves out a row whose time has passed, before DynamoDB deletes it', async () => {
		const expiring = new DynamoConnectionTable(table, {
			region,
			endpoint: LOCALSTACK_URL,
			ttl: -1,
		});
		await expiring.put({ id: 'old', data: {} });
		await rows.put({ id: 'new', data: {} });

		expect(await rows.ids()).toEqual(['new']);
		expect(await rows.get('old')).toBeUndefined();
	});
});
