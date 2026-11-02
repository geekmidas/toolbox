// @vitest-environment node
import { EnvironmentParser } from '@geekmidas/envkit';
import { UnauthorizedError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TestEndpointAdaptor } from '../../endpoints/TestEndpointAdaptor';
import { RestApi } from '../../rest-api';
import { WebSocketApi } from '../../websocket-api';
import {
	createMswWebSocketHandlers,
	REFUSED_CLOSE_BASE,
	TEST_CONTEXT_PARAM,
} from '../msw';

/**
 * The MSW adaptor: a real `WebSocket` client, intercepted by MSW, talking to
 * the surface's real routes — and an endpoint's push reaching it — with no
 * server listening anywhere.
 */

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
	path: '.',
	logger: silent,
	frame: { discriminator: 'type' },
	messages: {
		'chat.message.created': z.object({ chatId: z.string(), text: z.string() }),
	},
});

const seen: { query: string; session: unknown }[] = [];
const left: { id: string; code: number; data: unknown }[] = [];

const connect = realtime.connect().handle(({ session, query }) => {
	seen.push({ query: query.toString(), session });
	if (!session) throw new UnauthorizedError();
	return { email: (session as { email: string }).email };
});
const echo = realtime
	.route('echo')
	.body(z.object({ text: z.string() }))
	.handle(({ body, connection }) => ({
		said: body.text,
		by: connection.data.email,
	}));
const disconnect = realtime.disconnect().handle(({ connection, code }) => {
	left.push({ id: connection.id, code, data: connection.data });
});

const URL_BASE = 'wss://realtime.test';
const adaptor = createMswWebSocketHandlers(
	realtime,
	[{ connect, echo, disconnect }],
	{ url: URL_BASE },
);
const server = setupServer(...adaptor.handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
	seen.length = 0;
	left.length = 0;
});
afterAll(async () => {
	server.close();
	await adaptor.close();
});

/** A client socket, with the frames it received decoded in order. */
function client(url: string) {
	const socket = new WebSocket(url);
	const frames: unknown[] = [];
	const waiting: ((frame: unknown) => void)[] = [];
	socket.addEventListener('message', (event) => {
		const frame = JSON.parse(String(event.data));
		const next = waiting.shift();
		if (next) next(frame);
		else frames.push(frame);
	});
	const closed = new Promise<{ code: number; reason: string }>((resolve) =>
		socket.addEventListener('close', (event) =>
			resolve({ code: event.code, reason: event.reason }),
		),
	);
	return {
		socket,
		closed,
		opened: new Promise<void>((resolve) =>
			socket.addEventListener('open', () => resolve()),
		),
		next: () =>
			frames.length
				? Promise.resolve(frames.shift())
				: new Promise<unknown>((resolve) => waiting.push(resolve)),
	};
}

/** Until `check` holds — what the adaptor does after an event is async. */
async function eventually(check: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100 && !check(); attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	expect(check()).toBe(true);
}

function contextFor(session: unknown, services?: Record<string, unknown>) {
	const id = crypto.randomUUID();
	adaptor.registerContext(id, { session, ...(services ? { services } : {}) });
	return id;
}

describe('createMswWebSocketHandlers', () => {
	it('runs connect with the context session, then answers frames on the socket', async () => {
		const id = contextFor({ email: 'ada@shop.test' });
		const ada = client(`${URL_BASE}/?room=kitchen&${TEST_CONTEXT_PARAM}=${id}`);
		await ada.opened;
		ada.socket.send(JSON.stringify({ type: 'echo', text: 'hi' }));

		expect(await ada.next()).toEqual({
			type: 'echo',
			said: 'hi',
			by: 'ada@shop.test',
		});
		// The context parameter is the adaptor's; the handler never sees it.
		expect(seen).toEqual([
			{ query: 'room=kitchen', session: { email: 'ada@shop.test' } },
		]);

		ada.socket.send(JSON.stringify({ type: 'echo', text: 1 }));
		expect(await ada.next()).toMatchObject({
			type: '$error',
			message: 'The frame was invalid.',
		});
		ada.socket.close();
		await ada.closed;
	});

	it('closes a refused connection with 4000 + its status', async () => {
		const anonymous = client(URL_BASE);
		expect(await anonymous.closed).toMatchObject({
			code: REFUSED_CLOSE_BASE + 401,
		});
		expect(seen).toEqual([{ query: '', session: null }]);
	});

	it('closes a connection whose context nobody registered', async () => {
		const lost = client(`${URL_BASE}/?${TEST_CONTEXT_PARAM}=nobody`);
		expect((await lost.closed).code).toBe(1011);
		expect(seen).toEqual([]);
	});

	it("delivers an endpoint's push through the publisher to the client", async () => {
		const ada = client(
			`${URL_BASE}/?${TEST_CONTEXT_PARAM}=${contextFor({ email: 'ada@shop.test' })}`,
		);
		const bob = client(
			`${URL_BASE}/?${TEST_CONTEXT_PARAM}=${contextFor({ email: 'bob@shop.test' })}`,
		);
		await Promise.all([ada.opened, bob.opened]);
		await eventually(() => adaptor.connections.length === 2);
		const [adaId] = adaptor.connections.map((connection) => connection.id);

		const api = new RestApi('Api', {
			path: '.',
			defaultAuthorizer: 'none',
			logger: silent,
		});
		const post = api
			.post('/messages')
			.dependsOn([realtime])
			.body(z.object({ to: z.string(), text: z.string() }))
			.output(z.object({ ok: z.boolean() }))
			.handle(async ({ body, services }) => {
				await services.realtime.send(body.to, 'chat.message.created', {
					chatId: 'c1',
					text: body.text,
				});
				return { ok: true };
			});

		await new TestEndpointAdaptor(post).request({
			body: { to: adaId!, text: 'just you' },
			headers: {},
			services: { realtime: adaptor.publisher },
		});
		expect(await ada.next()).toEqual({
			type: 'chat.message.created',
			chatId: 'c1',
			text: 'just you',
		});

		// The surface's own service, registered onto the adaptor's channel.
		const registered = await realtime.service.register({
			envParser: new EnvironmentParser({
				REALTIME_PUBLISHER_CONNECTION_STRING: adaptor.connectionString,
			}),
		} as never);
		await registered.broadcast('chat.message.created', {
			chatId: 'c1',
			text: 'everyone',
		});
		expect(await ada.next()).toMatchObject({ text: 'everyone' });
		expect(await bob.next()).toMatchObject({ text: 'everyone' });

		ada.socket.close();
		bob.socket.close();
		await Promise.all([ada.closed, bob.closed]);
	});

	it('runs disconnect when either side closes', async () => {
		const ada = client(
			`${URL_BASE}/?${TEST_CONTEXT_PARAM}=${contextFor({ email: 'ada@shop.test' })}`,
		);
		await ada.opened;
		await eventually(() => adaptor.connections.length === 1);
		ada.socket.close(4001, 'bye');
		await eventually(() => left.length === 1);
		expect(left[0]).toMatchObject({
			code: 4001,
			data: { email: 'ada@shop.test' },
		});
		expect(adaptor.connections).toEqual([]);

		const bob = client(
			`${URL_BASE}/?${TEST_CONTEXT_PARAM}=${contextFor({ email: 'bob@shop.test' })}`,
		);
		await bob.opened;
		await eventually(() => adaptor.connections.length === 1);
		await adaptor.publisher.close(adaptor.connections[0]!.id, 4002, 'kicked');
		expect(await bob.closed).toEqual({ code: 4002, reason: 'kicked' });
		await eventually(() => left.length === 2);
	});
});
