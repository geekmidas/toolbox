/**
 * The API Gateway (v2, WebSocket) adaptor: a Lambda per route, over the
 * surface's `WebSocketCore`.
 *
 * API Gateway holds the sockets. A Lambda only sees events — `$connect`, a
 * frame on a route, `$disconnect` — so this owns what the gateway does not:
 *
 * - **the Origin check** in `$connect`, against the same origins the Node
 *   adaptor trusts;
 * - **the connection table**, where a connection's `data` (what the connect
 *   handler returned) is kept between invocations, and the ids a broadcast
 *   goes to are read from;
 * - **the sink**, `postToConnection` and `deleteConnection` on the management
 *   API, with a connection that has gone (410) dropped from the table rather
 *   than reported — as a Redis publisher drops a socket nobody holds.
 *
 * Both are reached through the surface's `<ID>_PUBLISHER_CONNECTION_STRING`,
 * an `apigateway://` string on an AWS stage, which is also what
 * `services.<surface>` reads in any other Lambda.
 *
 * The AWS SDK clients are optional peers, loaded the first time a send or a
 * table read needs one. Nothing here imports them at the top.
 */

import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import {
	type ApiGatewayWebSocketTarget,
	parseApiGatewayWebSocketUrl,
	trustsOrigin,
} from '@geekmidas/manifest';
import { OptionalPeerMissing } from '../endpoints/optionalPeers';
import type { WebSocketApi } from '../websocket-api';
import type { WebSocketCore } from './core';
import { ownOrigins } from './origins';
import type { NoMessages, WebSocketMessages, WebSocketSink } from './publisher';
import type { Connection } from './route';

/**
 * How long a row outlives its connection's start. API Gateway closes every
 * connection after two hours, so a row the `$disconnect` never deleted — a
 * Lambda that timed out — expires a little after that.
 */
export const CONNECTION_TTL_SECONDS = 2 * 60 * 60 + 10 * 60;

/**
 * Where a surface's open connections are kept on API Gateway, by id: the
 * `data` its connect handler returned, which every later invocation hands
 * to its route, and the list a broadcast goes to.
 */
export interface ConnectionTable {
	put(connection: Connection): Promise<void>;
	get(id: string): Promise<Connection | undefined>;
	delete(ids: readonly string[]): Promise<void>;
	/** Every open connection's id. */
	ids(): Promise<string[]>;
}

/** The subset of a DynamoDB client the table uses. */
interface DynamoClient {
	send(command: unknown): Promise<Record<string, unknown>>;
}

type DynamoModule = typeof import('@aws-sdk/client-dynamodb');
type ManagementModule =
	typeof import('@aws-sdk/client-apigatewaymanagementapi');

async function loadDynamo(): Promise<DynamoModule> {
	try {
		return await import('@aws-sdk/client-dynamodb');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'@aws-sdk/client-dynamodb',
			'A WebSocketApi served by API Gateway',
			cause,
		);
	}
}

async function loadManagement(): Promise<ManagementModule> {
	try {
		return await import('@aws-sdk/client-apigatewaymanagementapi');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'@aws-sdk/client-apigatewaymanagementapi',
			'A WebSocketApi served by API Gateway',
			cause,
		);
	}
}

/**
 * The connection table in DynamoDB: one item per connection, keyed by
 * `connectionId`, with its `data` as JSON and an `expiresAt` the table's TTL
 * reads. Provisioned beside the API by `@geekmidas/cloud`, so a surface on
 * AWS needs nothing declared for it.
 */
export class DynamoConnectionTable implements ConnectionTable {
	private client?: Promise<{ dynamo: DynamoModule; client: DynamoClient }>;

	constructor(
		readonly table: string,
		private readonly options: {
			region: string;
			/** An emulator's address; AWS's own when absent. */
			endpoint?: string;
			/** Seconds a row is kept. Default {@link CONNECTION_TTL_SECONDS}. */
			ttl?: number;
		},
	) {}

	private connect() {
		this.client ??= loadDynamo().then((dynamo) => ({
			dynamo,
			client: new dynamo.DynamoDBClient({
				region: this.options.region,
				...(this.options.endpoint ? { endpoint: this.options.endpoint } : {}),
			}) as unknown as DynamoClient,
		}));
		return this.client;
	}

	async put(connection: Connection): Promise<void> {
		const { dynamo, client } = await this.connect();
		const ttl = this.options.ttl ?? CONNECTION_TTL_SECONDS;
		await client.send(
			new dynamo.PutItemCommand({
				TableName: this.table,
				Item: {
					connectionId: { S: connection.id },
					data: { S: JSON.stringify(connection.data) },
					expiresAt: { N: String(nowSeconds() + ttl) },
				},
			}),
		);
	}

	async get(id: string): Promise<Connection | undefined> {
		const { dynamo, client } = await this.connect();
		const { Item: item } = (await client.send(
			new dynamo.GetItemCommand({
				TableName: this.table,
				Key: { connectionId: { S: id } },
				// `$connect` wrote it a moment ago; the first frame must see it.
				ConsistentRead: true,
			}),
		)) as { Item?: Record<string, { S?: string; N?: string }> };
		if (!item || expired(item)) return undefined;
		return { id, data: JSON.parse(item.data?.S ?? '{}') };
	}

	async delete(ids: readonly string[]): Promise<void> {
		if (ids.length === 0) return;
		const { dynamo, client } = await this.connect();
		await Promise.all(
			ids.map((id) =>
				client.send(
					new dynamo.DeleteItemCommand({
						TableName: this.table,
						Key: { connectionId: { S: id } },
					}),
				),
			),
		);
	}

	async ids(): Promise<string[]> {
		const { dynamo, client } = await this.connect();
		const ids: string[] = [];
		let start: Record<string, unknown> | undefined;
		do {
			const page = (await client.send(
				new dynamo.ScanCommand({
					TableName: this.table,
					ProjectionExpression: 'connectionId, expiresAt',
					...(start ? { ExclusiveStartKey: start as never } : {}),
				}),
			)) as {
				Items?: Record<string, { S?: string; N?: string }>[];
				LastEvaluatedKey?: Record<string, unknown>;
			};
			for (const item of page.Items ?? []) {
				// DynamoDB deletes an expired item eventually, not on time.
				if (item.connectionId?.S && !expired(item)) {
					ids.push(item.connectionId.S);
				}
			}
			start = page.LastEvaluatedKey;
		} while (start);
		return ids;
	}
}

/** The subset of a management API client the sink uses. */
interface ManagementClient {
	send(command: unknown): Promise<unknown>;
}

/**
 * A publisher's sink on API Gateway: each send a `postToConnection`, each
 * close a `deleteConnection`, a broadcast every id in the table. A connection
 * that has gone answers 410; it is dropped from the table, and the send to
 * the rest goes on.
 *
 * API Gateway closes a connection with a code of its own: `close(ids, code,
 * reason)` ends the connections, but its client does not see `code` or
 * `reason`.
 */
export class ApiGatewaySink implements WebSocketSink {
	private client?: Promise<{
		management: ManagementModule;
		client: ManagementClient;
	}>;

	constructor(
		private readonly target: Pick<
			ApiGatewayWebSocketTarget,
			'endpoint' | 'region'
		>,
		private readonly table: ConnectionTable,
	) {}

	private connect() {
		this.client ??= loadManagement().then((management) => ({
			management,
			client: new management.ApiGatewayManagementApiClient({
				region: this.target.region,
				endpoint: this.target.endpoint,
			}) as unknown as ManagementClient,
		}));
		return this.client;
	}

	async send(ids: readonly string[], payload: string): Promise<void> {
		if (ids.length === 0) return;
		const { management, client } = await this.connect();
		const data = new TextEncoder().encode(payload);
		const gone = await this.each(ids, (id) =>
			client.send(
				new management.PostToConnectionCommand({
					ConnectionId: id,
					Data: data,
				}),
			),
		);
		await this.table.delete(gone);
	}

	async broadcast(payload: string, except?: readonly string[]): Promise<void> {
		const skip = new Set(except ?? []);
		const ids = (await this.table.ids()).filter((id) => !skip.has(id));
		await this.send(ids, payload);
	}

	async close(ids: readonly string[]): Promise<void> {
		if (ids.length === 0) return;
		const { management, client } = await this.connect();
		await this.each(ids, (id) =>
			client.send(new management.DeleteConnectionCommand({ ConnectionId: id })),
		);
		// Its `$disconnect` deletes the row too; a connection that was already
		// gone has no `$disconnect` left to run.
		await this.table.delete(ids);
	}

	/** Call `fn` for each id; the ids that had gone. Anything else throws. */
	private async each(
		ids: readonly string[],
		fn: (id: string) => Promise<unknown>,
	): Promise<string[]> {
		const gone: string[] = [];
		await Promise.all(
			ids.map(async (id) => {
				try {
					await fn(id);
				} catch (error) {
					if (!isGone(error)) throw error;
					gone.push(id);
				}
			}),
		);
		return gone;
	}
}

/** A table and a sink from an `apigateway://` publisher string. */
export function apiGatewayFromConnectionString(connectionString: string): {
	target: ApiGatewayWebSocketTarget;
	table: DynamoConnectionTable;
	sink: ApiGatewaySink;
} {
	const target = parseApiGatewayWebSocketUrl(connectionString);
	const table = new DynamoConnectionTable(target.table, {
		region: target.region,
		...(target.tableEndpoint ? { endpoint: target.tableEndpoint } : {}),
	});
	return { target, table, sink: new ApiGatewaySink(target, table) };
}

/**
 * What API Gateway invokes a WebSocket route's Lambda with — the fields this
 * adaptor reads. `headers` and the query arrive on `$connect` only.
 */
export interface ApiGatewayWebSocketEvent {
	requestContext: {
		connectionId: string;
		eventType: 'CONNECT' | 'MESSAGE' | 'DISCONNECT';
		routeKey: string;
		disconnectStatusCode?: number;
		disconnectReason?: string;
	};
	headers?: Record<string, string | undefined> | null;
	multiValueHeaders?: Record<string, string[] | undefined> | null;
	queryStringParameters?: Record<string, string | undefined> | null;
	multiValueQueryStringParameters?: Record<string, string[] | undefined> | null;
	body?: string | null;
	isBase64Encoded?: boolean;
}

/** What the Lambda answers: a non-2xx on `$connect` refuses the socket. */
export interface ApiGatewayWebSocketResult {
	statusCode: number;
	body?: string;
}

export interface AmazonApiGatewayWebSocketOptions {
	/**
	 * Files exporting the routes this Lambda serves — the generated handler
	 * hands in the one route API Gateway invokes it for.
	 */
	modules?: readonly object[];
	/** Where the surface's keys are read. Absent, the surface's own parser. */
	envParser?: EnvironmentParser<{}>;
	/**
	 * The connection table and the sink, in place of the ones the
	 * `apigateway://` publisher string names.
	 */
	table?: ConnectionTable;
	sink?: WebSocketSink;
}

/**
 * A WebSocket surface served by API Gateway: `handler` is the Lambda for one
 * or more of its routes.
 *
 * ```ts
 * // .gkm/aws/websocket/routes/send.ts, as `gkm build --provider aws` writes it
 * const adaptor = new AmazonApiGatewayWebSocket(realtime, { modules: [{ send }] });
 * export const handler = adaptor.handler;
 * ```
 */
export class AmazonApiGatewayWebSocket<
	TMessages extends WebSocketMessages = NoMessages,
> {
	private ready?: Promise<{
		core: WebSocketCore<TMessages>;
		table: ConnectionTable;
		sink: WebSocketSink;
		trusted: string[];
	}>;

	constructor(
		private readonly surface: WebSocketApi<string, TMessages>,
		private readonly options: AmazonApiGatewayWebSocketOptions = {},
	) {}

	/** The Lambda handler. */
	readonly handler = (
		event: ApiGatewayWebSocketEvent,
	): Promise<ApiGatewayWebSocketResult> => this.handle(event);

	private get logger(): Logger {
		return this.surface.logger;
	}

	/** Read the keys and build the core once per container. */
	private setup() {
		this.ready ??= Promise.resolve().then(() => {
			const envParser = this.options.envParser ?? this.surface.envParser;
			const { keys } = this.surface;
			const config = envParser
				.create((get) => ({
					connectionString: get(keys.publisherConnectionString)
						.string()
						.optional(),
					origins: get(keys.trustedOrigins)
						.string()
						.default('')
						.transform((value: string) =>
							value
								.split(',')
								.map((origin) => origin.trim())
								.filter(Boolean),
						),
					url: get(keys.url).string().optional(),
				}))
				.parse();

			let { table, sink } = this.options;
			if (!table || !sink) {
				if (!config.connectionString) {
					throw new WebSocketPublisherNotConfigured(
						this.surface.id,
						keys.publisherConnectionString,
					);
				}
				const fromString = apiGatewayFromConnectionString(
					config.connectionString,
				);
				table ??= fromString.table;
				sink ??= fromString.sink;
			}

			const core = this.surface.core({
				envParser,
				sink,
				...(this.options.modules ? { modules: this.options.modules } : {}),
			});
			return {
				core,
				table,
				sink,
				trusted: [...config.origins, ...ownOrigins(config.url)],
			};
		});
		return this.ready;
	}

	async handle(
		event: ApiGatewayWebSocketEvent,
	): Promise<ApiGatewayWebSocketResult> {
		const { connectionId, eventType } = event.requestContext;
		const { core, table, sink, trusted } = await this.setup();

		if (eventType === 'CONNECT') {
			const headers = headersOf(event);
			const origin = headers.get('origin');
			if (origin && !trustsOrigin(origin, trusted)) {
				return { statusCode: 403, body: 'Forbidden' };
			}

			const outcome = await core.connect({
				connectionId,
				headers,
				query: queryOf(event),
			});
			if (!outcome.accepted) {
				return { statusCode: outcome.status, body: outcome.statusText };
			}
			await table.put(outcome.connection);
			return { statusCode: 200 };
		}

		// A connection the table no longer has — a row that expired early, or
		// one written by a `$connect` that failed after accepting — is still
		// served, with nothing its connect handler said about it.
		const connection = (await table.get(connectionId)) ?? {
			id: connectionId,
			data: {},
		};

		if (eventType === 'DISCONNECT') {
			await core.disconnect(connection, {
				code: event.requestContext.disconnectStatusCode ?? 1005,
				reason: event.requestContext.disconnectReason ?? '',
			});
			await table.delete([connectionId]);
			return { statusCode: 200 };
		}

		// What the route writes back — its reply, `reply()`, an `$error` — is
		// posted to the caller, and waited for before the Lambda returns: a
		// frozen container sends nothing.
		const writes: Promise<void>[] = [];
		const write = (payload: string) => {
			writes.push(
				sink.send([connectionId], payload).catch((error) => {
					this.logger.error(
						{ err: error, connectionId },
						'WebSocket reply could not be posted',
					);
				}),
			);
		};
		const raw = event.isBase64Encoded
			? Uint8Array.from(Buffer.from(event.body ?? '', 'base64'))
			: (event.body ?? '');
		await core.message(connection, raw, write);
		await Promise.all(writes);
		return { statusCode: 200 };
	}
}

/** A Lambda of the surface was started without its publisher string. */
export class WebSocketPublisherNotConfigured extends Error {
	constructor(
		readonly surface: string,
		readonly key: string,
	) {
		super(
			`${surface}'s Lambda has no ${key}, so it cannot reach its connections. Link the route to its surface — gkm build and @geekmidas/cloud's fromManifest do — or pass a table and a sink to AmazonApiGatewayWebSocket.`,
		);
		this.name = 'WebSocketPublisherNotConfigured';
	}
}

function headersOf(event: ApiGatewayWebSocketEvent): Headers {
	const headers = new Headers();
	if (event.multiValueHeaders) {
		for (const [name, values] of Object.entries(event.multiValueHeaders)) {
			for (const value of values ?? []) headers.append(name, value);
		}
		return headers;
	}
	for (const [name, value] of Object.entries(event.headers ?? {})) {
		if (value !== undefined) headers.append(name, value);
	}
	return headers;
}

function queryOf(event: ApiGatewayWebSocketEvent): URLSearchParams {
	const query = new URLSearchParams();
	if (event.multiValueQueryStringParameters) {
		for (const [name, values] of Object.entries(
			event.multiValueQueryStringParameters,
		)) {
			for (const value of values ?? []) query.append(name, value);
		}
		return query;
	}
	for (const [name, value] of Object.entries(
		event.queryStringParameters ?? {},
	)) {
		if (value !== undefined) query.append(name, value);
	}
	return query;
}

/** A management API answer for a connection that has gone. */
function isGone(error: unknown): boolean {
	const e = error as {
		name?: string;
		$metadata?: { httpStatusCode?: number };
	} | null;
	return e?.name === 'GoneException' || e?.$metadata?.httpStatusCode === 410;
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function expired(item: Record<string, { N?: string }>): boolean {
	const at = Number(item.expiresAt?.N);
	return Number.isFinite(at) && at > 0 && at <= nowSeconds();
}
