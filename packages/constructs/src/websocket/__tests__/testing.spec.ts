// @vitest-environment node
import {
	ForbiddenError,
	UnauthorizedError,
	UnprocessableEntityError,
} from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Authenticator } from '../../construct-interface';
import { TestEndpointAdaptor } from '../../endpoints/TestEndpointAdaptor';
import { RestApi } from '../../rest-api';
import { WebSocketApi } from '../../websocket-api';
import { InvalidWebSocketMessage, UnknownWebSocketMessage } from '../publisher';
import { InvalidWebSocketRequest, TestWebSocketPublisher } from '../testing';

/**
 * The Test adaptor: a route run by `request()` and a publisher that records,
 * with no server, no socket and no transport anywhere in the file.
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

const messages = {
	'chat.message.created': z.object({
		chatId: z.string(),
		text: z.string().trim(),
	}),
	'presence.joined': z.object({ user: z.string() }),
};

const realtime = new WebSocketApi('Realtime', {
	path: '.',
	logger: silent,
	messages,
});

/** A construct whose service counts how often it was registered. */
function ledger() {
	const registered: number[] = [];
	const id = `Ledger${Math.random().toString(36).slice(2)}`;
	const construct = {
		id,
		service: {
			serviceName: 'ledger' as const,
			async register() {
				registered.push(1);
				return { entries: ['registered'] };
			},
		},
		declare: () => [],
	};
	return { construct, registered };
}

describe('connect.request()', () => {
	const connect = realtime.connect().handle(({ session, query }) => {
		if (!session) throw new UnauthorizedError('Sign in first');
		const { email } = (session as { user: { email: string } }).user;
		if (email.endsWith('@banned.test')) throw new ForbiddenError();
		return { email, room: query.get('room') ?? 'lobby' };
	});

	it('resolves with what the handler returned: the connection data', async () => {
		await expect(
			connect.request({
				session: { user: { email: 'ada@shop.test' } },
				query: { room: 'kitchen' },
			}),
		).resolves.toEqual({ email: 'ada@shop.test', room: 'kitchen' });
	});

	it('rejects with the HttpError that refused the connection', async () => {
		const refused = connect.request({ session: null });
		await expect(refused).rejects.toBeInstanceOf(UnauthorizedError);
		await expect(refused).rejects.toMatchObject({ statusCode: 401 });

		await expect(
			connect.request({ session: { user: { email: 'eve@banned.test' } } }),
		).rejects.toMatchObject({ statusCode: 403 });
	});

	it('keeps {} as the data of a handler that returns nothing', async () => {
		const open = realtime.connect().handle(() => undefined);
		await expect(open.request()).resolves.toEqual({});
	});

	it("runs the surface's .auth() on the headers when no session is given", async () => {
		const seen: (string | null)[] = [];
		const auth: Authenticator<{ user: { email: string } }> = {
			id: 'Auth',
			declare: () => [],
			async verify(headers) {
				seen.push(headers.get('cookie'));
				return headers.get('cookie') === 'session=ada'
					? { user: { email: 'ada@shop.test' } }
					: null;
			},
		};
		const authed = realtime.auth(auth);
		const whoami = authed.connect().handle(({ session, connectionId }) => {
			if (!session) throw new UnauthorizedError();
			return { connectionId, ...(session as object) };
		});

		await expect(
			whoami.request({
				connectionId: 'a.1',
				headers: { cookie: 'session=ada' },
			}),
		).resolves.toEqual({
			connectionId: 'a.1',
			user: { email: 'ada@shop.test' },
		});
		await expect(whoami.request()).rejects.toBeInstanceOf(UnauthorizedError);
		// A given session skips the authenticator, as a test means it to.
		await whoami.request({ session: { user: { email: 'bob@shop.test' } } });
		expect(seen).toEqual(['session=ada', null]);
	});

	it('hands in services in place of registering them, and registers the rest', async () => {
		const { construct, registered } = ledger();
		const reads = realtime
			.connect()
			.dependsOn([construct])
			.handle(({ services }) => ({ entries: services.ledger.entries }));

		await expect(
			reads.request({ services: { ledger: { entries: ['given'] } } }),
		).resolves.toEqual({ entries: ['given'] });
		expect(registered).toEqual([]);

		await expect(reads.request()).resolves.toEqual({
			entries: ['registered'],
		});
		expect(registered).toEqual([1]);
	});
});

describe('route.request()', () => {
	const say = realtime
		.route('chat.say')
		.body(z.object({ chatId: z.string(), text: z.string() }))
		.handle(async ({ body, connection, sockets }) => {
			if (body.text === 'forbidden') throw new UnprocessableEntityError('No');
			await sockets.broadcast(
				'chat.message.created',
				{ chatId: body.chatId, text: body.text },
				{ except: [connection.id] },
			);
			return { ok: true, by: connection.data.email as string };
		});

	it('resolves with the handler return, the body checked by its schema', async () => {
		await expect(
			say.request({
				connection: { id: 'a.1', data: { email: 'ada@shop.test' } },
				body: { chatId: 'c1', text: 'hi' },
			}),
		).resolves.toEqual({ ok: true, by: 'ada@shop.test' });
	});

	it('rejects a body its schema refuses, with the issues', async () => {
		const refused = say.request({
			body: { chatId: 1 } as unknown as { chatId: string; text: string },
		});
		await expect(refused).rejects.toBeInstanceOf(InvalidWebSocketRequest);
		await expect(refused).rejects.toMatchObject({
			surface: 'Realtime',
			action: 'chat.say',
			reason: 'The frame was invalid.',
			issues: expect.arrayContaining([
				expect.objectContaining({ path: ['chatId'] }),
			]),
		});
	});

	it('rejects with what the handler threw', async () => {
		await expect(
			say.request({ body: { chatId: 'c1', text: 'forbidden' } }),
		).rejects.toBeInstanceOf(UnprocessableEntityError);
	});

	it("records what the handler sent through sockets, checked by the surface's messages", async () => {
		const sockets = realtime.testPublisher();
		await say.request({
			connection: { id: 'a.1', data: { email: 'ada@shop.test' } },
			body: { chatId: 'c1', text: '  hi  ' },
			sockets,
		});

		expect(sockets.broadcasts).toEqual([
			{
				action: 'chat.message.created',
				// Trimmed: what the schema returned is what is sent.
				data: { chatId: 'c1', text: 'hi' },
				except: ['a.1'],
				frame: {
					action: 'chat.message.created',
					data: { chatId: 'c1', text: 'hi' },
				},
			},
		]);
		expect(sockets.sent).toEqual([]);
	});

	it('fullRequest() also returns every frame written back: reply() and the reply', async () => {
		const typing = realtime.route('chat.typing').handle(({ reply }) => {
			reply({ action: 'ack' });
			return { typing: true };
		});

		await expect(
			typing.fullRequest({ body: undefined, id: 7 }),
		).resolves.toEqual({
			returned: { typing: true },
			frames: [
				{ action: 'ack' },
				{ action: 'chat.typing', id: 7, data: { typing: true } },
			],
		});
	});

	it('encodes the body as a flat frame on a surface with a discriminator', async () => {
		const flat = new WebSocketApi('Flat', {
			path: '.',
			logger: silent,
			frame: { discriminator: 'type' },
			messages,
		});
		const echo = flat
			.route('echo')
			.body(z.object({ text: z.string() }))
			.handle(({ body }) => ({ said: body.text }));

		await expect(echo.fullRequest({ body: { text: 'hi' } })).resolves.toEqual({
			returned: { said: 'hi' },
			frames: [{ type: 'echo', said: 'hi' }],
		});
	});
});

describe('disconnect.request()', () => {
	it('runs the handler with the connection and the close code', async () => {
		const left: unknown[] = [];
		const disconnect = realtime
			.disconnect()
			.handle(async ({ connection, code, reason, sockets }) => {
				left.push({ connection, code, reason });
				await sockets.broadcast('presence.joined', { user: 'gone' });
			});
		const sockets = realtime.testPublisher();

		await disconnect.request({
			connection: { id: 'a.1', data: { email: 'ada@shop.test' } },
			code: 4001,
			reason: 'bye',
			sockets,
		});
		expect(left).toEqual([
			{
				connection: { id: 'a.1', data: { email: 'ada@shop.test' } },
				code: 4001,
				reason: 'bye',
			},
		]);
		expect(sockets.broadcasts).toHaveLength(1);

		// Defaults: a fresh connection, closed normally.
		await disconnect.request();
		expect(left[1]).toMatchObject({ code: 1000, reason: '' });
	});

	it('rejects with what the handler threw, which the core only logs', async () => {
		const boom = new TypeError('boom');
		const disconnect = realtime.disconnect().handle(() => {
			throw boom;
		});
		await expect(disconnect.request()).rejects.toBe(boom);
	});
});

describe('surface.testPublisher()', () => {
	it('records sends, broadcasts and closes, in order', async () => {
		const publisher = realtime.testPublisher();
		expect(publisher).toBeInstanceOf(TestWebSocketPublisher);

		await publisher.send(['a.1', 'b.2'], 'chat.message.created', {
			chatId: 'c1',
			text: ' hi ',
		});
		await publisher.send('a.1', 'presence.joined', { user: 'ada' });
		await publisher.broadcast('presence.joined', { user: 'bob' });
		await publisher.close('a.1', 4000, 'kicked');

		expect(publisher.sent).toEqual([
			{
				ids: ['a.1', 'b.2'],
				action: 'chat.message.created',
				data: { chatId: 'c1', text: 'hi' },
				frame: {
					action: 'chat.message.created',
					data: { chatId: 'c1', text: 'hi' },
				},
			},
			{
				ids: ['a.1'],
				action: 'presence.joined',
				data: { user: 'ada' },
				frame: { action: 'presence.joined', data: { user: 'ada' } },
			},
		]);
		expect(publisher.broadcasts).toEqual([
			{
				action: 'presence.joined',
				data: { user: 'bob' },
				except: [],
				frame: { action: 'presence.joined', data: { user: 'bob' } },
			},
		]);
		expect(publisher.closed).toEqual([
			{ ids: ['a.1'], code: 4000, reason: 'kicked' },
		]);

		publisher.clear();
		expect([publisher.sent, publisher.broadcasts, publisher.closed]).toEqual([
			[],
			[],
			[],
		]);
	});

	it('refuses what production would: an undeclared action, invalid data', async () => {
		const publisher = realtime.testPublisher();
		await expect(
			publisher.send('a.1', 'chat.deleted' as never, {} as never),
		).rejects.toBeInstanceOf(UnknownWebSocketMessage);
		await expect(
			publisher.send('a.1', 'presence.joined', { user: 1 } as never),
		).rejects.toBeInstanceOf(InvalidWebSocketMessage);
		expect(publisher.sent).toEqual([]);
	});

	it('exposes the flat wire frame on a surface with a discriminator', async () => {
		const flat = new WebSocketApi('Flat', {
			path: '.',
			logger: silent,
			frame: { discriminator: 'type' },
			messages,
		});
		const publisher = flat.testPublisher();
		await publisher.send('a.1', 'chat.message.created', {
			chatId: 'c1',
			text: 'hi',
		});

		expect(publisher.sent[0]).toEqual({
			ids: ['a.1'],
			action: 'chat.message.created',
			data: { chatId: 'c1', text: 'hi' },
			frame: { type: 'chat.message.created', chatId: 'c1', text: 'hi' },
		});
	});

	it("is what an endpoint's spec hands in for services.<surface>", async () => {
		const api = new RestApi('Api', {
			path: '.',
			defaultAuthorizer: 'none',
			logger: silent,
		});
		const post = api
			.post('/chats/:chatId/messages')
			.dependsOn([realtime])
			.params(z.object({ chatId: z.string() }))
			.body(z.object({ to: z.array(z.string()), text: z.string() }))
			.output(z.object({ sent: z.number() }))
			.handle(async ({ params, body, services }) => {
				await services.realtime.send(body.to, 'chat.message.created', {
					chatId: params.chatId,
					text: body.text,
				});
				return { sent: body.to.length };
			});

		const sockets = realtime.testPublisher();
		await expect(
			new TestEndpointAdaptor(post).request({
				params: { chatId: 'c1' },
				body: { to: ['a.1', 'b.7'], text: 'hello' },
				headers: {},
				services: { realtime: sockets },
			}),
		).resolves.toEqual({ sent: 2 });

		expect(sockets.sent).toEqual([
			expect.objectContaining({
				ids: ['a.1', 'b.7'],
				action: 'chat.message.created',
				data: { chatId: 'c1', text: 'hello' },
			}),
		]);
	});
});
