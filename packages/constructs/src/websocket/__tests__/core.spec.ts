// @vitest-environment node
import { EnvironmentParser } from '@geekmidas/envkit';
import { ForbiddenError, UnauthorizedError } from '@geekmidas/errors';
import type { Logger } from '@geekmidas/logger';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Authenticator } from '../../construct-interface';
import { WebSocketApi } from '../../websocket-api';
import { DuplicateWebSocketRoute, WebSocketCore } from '../core';
import { InvalidWebSocketMessage, type WebSocketSink } from '../publisher';
import type { Connection } from '../route';

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
	fatal() {},
	trace() {},
	child: () => silent,
} as unknown as Logger;

/** A sink that keeps what it was handed — the core needs no socket. */
function recordingSink() {
	const calls: {
		sent: { ids: readonly string[]; payload: unknown }[];
		broadcasts: { payload: unknown; except?: readonly string[] }[];
		closed: { ids: readonly string[]; code: number; reason: string }[];
	} = { sent: [], broadcasts: [], closed: [] };
	const sink: WebSocketSink = {
		async send(ids, payload) {
			calls.sent.push({ ids, payload: JSON.parse(payload) });
		},
		async broadcast(payload, except) {
			calls.broadcasts.push({
				payload: JSON.parse(payload),
				...(except ? { except } : {}),
			});
		},
		async close(ids, code, reason) {
			calls.closed.push({ ids, code, reason });
		},
	};
	return { sink, calls };
}

/** The core for `surface`'s routes in `modules`, and what it wrote. */
function coreOf(surface: WebSocketApi<string, any>, modules: object[] = []) {
	const { sink, calls } = recordingSink();
	const core = surface.core({
		envParser: new EnvironmentParser({}),
		sink,
		modules,
	});
	const written: unknown[] = [];
	const write = (payload: string) => written.push(JSON.parse(payload));
	return { core, calls, written, write };
}

const connection: Connection = { id: 'test.1', data: { user: 'ada' } };

function surface(config: Partial<{ frame: { discriminator: string } }> = {}) {
	return new WebSocketApi('Realtime', { path: '.', logger: silent, ...config });
}

describe('WebSocketCore.message', () => {
	it('runs the route for a frame and writes back what it returned', async () => {
		const realtime = surface();
		const echo = realtime
			.route('echo')
			.body(z.object({ text: z.string().trim() }))
			.handle(({ body, connection }) => ({
				said: body.text,
				by: connection.data,
			}));
		const { core, write, written } = coreOf(realtime, [{ echo }]);

		const outcome = await core.message(
			connection,
			JSON.stringify({ action: 'echo', id: 7, data: { text: '  hi ' } }),
			write,
		);

		expect(outcome).toEqual({
			ok: true,
			action: 'echo',
			id: 7,
			returned: { said: 'hi', by: { user: 'ada' } },
		});
		expect(written).toEqual([
			{ action: 'echo', id: 7, data: { said: 'hi', by: { user: 'ada' } } },
		]);
	});

	it('writes nothing back for a handler that returns nothing, and passes reply() through', async () => {
		const realtime = surface();
		const ping = realtime.route('ping').handle(({ reply }) => {
			reply({ pong: true });
		});
		const { core, write, written } = coreOf(realtime, [{ ping }]);

		await expect(
			core.message(connection, JSON.stringify({ action: 'ping' }), write),
		).resolves.toEqual({ ok: true, action: 'ping', returned: undefined });
		expect(written).toEqual([{ pong: true }]);
	});

	it('answers each bad frame with an $error, and says why in its outcome', async () => {
		const realtime = surface();
		const echo = realtime
			.route('echo')
			.body(z.object({ text: z.string() }))
			.handle(({ body }) => body);
		const { core, write, written } = coreOf(realtime, [{ echo }]);

		expect(await core.message(connection, new Uint8Array([1]), write)).toEqual({
			ok: false,
			message: 'Frames are JSON text.',
		});
		expect(await core.message(connection, 'not json', write)).toEqual({
			ok: false,
			message: 'Frames are JSON.',
		});
		expect(
			await core.message(connection, JSON.stringify({ id: 1 }), write),
		).toEqual({ ok: false, id: 1, message: 'A frame names its `action`.' });
		expect(
			await core.message(
				connection,
				JSON.stringify({ action: 'nope', id: 2 }),
				write,
			),
		).toEqual({
			ok: false,
			action: 'nope',
			id: 2,
			message: "No route answers 'nope'.",
		});
		const invalid = await core.message(
			connection,
			JSON.stringify({ action: 'echo', id: 3, data: { text: 3 } }),
			write,
		);
		expect(invalid).toMatchObject({
			ok: false,
			action: 'echo',
			message: 'The frame was invalid.',
		});
		expect(invalid.ok === false && invalid.issues).toHaveLength(1);

		expect(written).toEqual([
			{ action: '$error', data: { message: 'Frames are JSON text.' } },
			{ action: '$error', data: { message: 'Frames are JSON.' } },
			{
				action: '$error',
				id: 1,
				data: { message: 'A frame names its `action`.' },
			},
			{
				action: '$error',
				id: 2,
				data: { message: "No route answers 'nope'." },
			},
			{
				action: '$error',
				id: 3,
				data: { message: 'The frame was invalid.', issues: expect.any(Array) },
			},
		]);
	});

	it('sends an HttpError its message, and anything else a generic one, with the error in the outcome', async () => {
		const realtime = surface();
		const forbidden = new ForbiddenError('Not your chat.');
		const boom = new TypeError('boom');
		const guarded = realtime.route('guarded').handle(() => {
			throw forbidden;
		});
		const broken = realtime.route('broken').handle(() => {
			throw boom;
		});
		const { core, write, written } = coreOf(realtime, [{ guarded, broken }]);

		await expect(
			core.message(connection, JSON.stringify({ action: 'guarded' }), write),
		).resolves.toEqual({
			ok: false,
			action: 'guarded',
			message: 'Not your chat.',
			error: forbidden,
		});
		await expect(
			core.message(connection, JSON.stringify({ action: 'broken' }), write),
		).resolves.toEqual({
			ok: false,
			action: 'broken',
			message: 'The route failed.',
			error: boom,
		});
		expect(written).toEqual([
			{ action: '$error', data: { message: 'Not your chat.' } },
			{ action: '$error', data: { message: 'The route failed.' } },
		]);
	});

	it('routes an action nothing answers to $default', async () => {
		const realtime = surface();
		const fallback = realtime
			.route('$default')
			.handle(({ body }) => ({ caught: body }));
		const { core, write, written } = coreOf(realtime, [{ fallback }]);

		await core.message(
			connection,
			JSON.stringify({ action: 'anything', data: 1 }),
			write,
		);

		expect(written).toEqual([{ action: 'anything', data: { caught: 1 } }]);
	});

	it('reads and writes flat frames under the surface discriminator', async () => {
		const realtime = surface({ frame: { discriminator: 'type' } });
		const say = realtime
			.route('chat.say')
			.body(z.object({ text: z.string() }))
			.handle(({ body }) => ({ heard: body.text }));
		const { core, write, written } = coreOf(realtime, [{ say }]);

		await core.message(
			connection,
			JSON.stringify({ type: 'chat.say', text: 'hi' }),
			write,
		);
		await core.message(connection, JSON.stringify({ type: 'nope' }), write);

		expect(written).toEqual([
			{ type: 'chat.say', heard: 'hi' },
			{ type: '$error', message: "No route answers 'nope'." },
		]);
		expect(core.frame.key).toBe('type');
	});
});

describe('WebSocketCore.connect', () => {
	const request = (query = '') => ({
		connectionId: 'test.1',
		headers: new Headers(),
		query: new URLSearchParams(query),
	});

	it('accepts every handshake, with no data, when there is no connect handler', async () => {
		const { core } = coreOf(surface());

		await expect(core.connect(request())).resolves.toEqual({
			accepted: true,
			connection: { id: 'test.1', data: {} },
		});
	});

	it('keeps what connect returned as the data, and refuses with the HttpError it threw', async () => {
		const realtime = surface();
		const connect = realtime.connect().handle(({ query, connectionId }) => {
			const user = query.get('user');
			if (!user) throw new UnauthorizedError('Who are you?');
			return { user, connectionId };
		});
		const { core } = coreOf(realtime, [{ connect }]);

		await expect(core.connect(request('user=ada'))).resolves.toEqual({
			accepted: true,
			connection: {
				id: 'test.1',
				data: { user: 'ada', connectionId: 'test.1' },
			},
		});

		const refused = await core.connect(request());
		expect(refused).toMatchObject({
			accepted: false,
			status: 401,
			statusText: 'Unauthorized',
		});
		expect(refused.accepted === false && refused.error).toBeInstanceOf(
			UnauthorizedError,
		);
	});

	it('refuses with 500 when connect fails with anything but an HttpError', async () => {
		const realtime = surface();
		const connect = realtime.connect().handle(() => {
			throw new TypeError('boom');
		});
		const { core } = coreOf(realtime, [{ connect }]);

		await expect(core.connect(request())).resolves.toMatchObject({
			accepted: false,
			status: 500,
			statusText: 'Internal Server Error',
			error: expect.any(TypeError),
		});
	});

	it('verifies the headers with the surface authenticator, unless a session is given', async () => {
		const verified: string[] = [];
		const auth: Authenticator<{ userId: string }> = {
			id: 'Auth',
			declare: () => [{ kind: 'oidc', id: 'Auth', provides: [] } as never],
			async verify(headers) {
				verified.push(headers.get('authorization') ?? '');
				return headers.get('authorization') === 'Bearer good'
					? { userId: 'u1' }
					: null;
			},
		};
		const realtime = surface().auth(auth);
		const connect = realtime.connect().handle(({ session }) => {
			if (!session) throw new UnauthorizedError();
			return session as { userId: string };
		});
		const { core } = coreOf(realtime, [{ connect }]);

		await expect(
			core.connect({
				...request(),
				headers: new Headers({ authorization: 'Bearer good' }),
			}),
		).resolves.toMatchObject({
			accepted: true,
			connection: { data: { userId: 'u1' } },
		});
		await expect(core.connect(request())).resolves.toMatchObject({
			accepted: false,
			status: 401,
		});

		// A session the adaptor already has is used as it is.
		await expect(
			core.connect({ ...request(), session: { userId: 'u2' } }),
		).resolves.toMatchObject({
			accepted: true,
			connection: { data: { userId: 'u2' } },
		});
		await expect(
			core.connect({ ...request(), session: null }),
		).resolves.toMatchObject({ accepted: false, status: 401 });
		expect(verified).toEqual(['Bearer good', '']);
	});
});

describe('WebSocketCore.disconnect', () => {
	it('runs the disconnect handler with the close code and reason', async () => {
		const realtime = surface();
		const left: unknown[] = [];
		const disconnect = realtime
			.disconnect()
			.handle(({ connection, code, reason }) => {
				left.push({ id: connection.id, data: connection.data, code, reason });
			});
		const { core } = coreOf(realtime, [{ disconnect }]);

		await expect(
			core.disconnect(connection, { code: 4001, reason: 'bye' }),
		).resolves.toEqual({ ok: true });
		expect(left).toEqual([
			{ id: 'test.1', data: { user: 'ada' }, code: 4001, reason: 'bye' },
		]);
	});

	it('returns what the handler threw instead of throwing it', async () => {
		const realtime = surface();
		const boom = new TypeError('boom');
		const disconnect = realtime.disconnect().handle(() => {
			throw boom;
		});
		const { core } = coreOf(realtime, [{ disconnect }]);

		await expect(
			core.disconnect(connection, { code: 1000, reason: '' }),
		).resolves.toEqual({ ok: false, error: boom });
		await expect(
			coreOf(surface()).core.disconnect(connection, { code: 1000, reason: '' }),
		).resolves.toEqual({ ok: true });
	});
});

describe('WebSocketCore services and sockets', () => {
	/** A construct whose service counts its registrations. */
	function ledger(id: string) {
		const registered: number[] = [];
		const construct = {
			id,
			service: {
				serviceName: id.toLowerCase() as Uncapitalize<string>,
				async register() {
					registered.push(1);
					return { name: 'registered' };
				},
			},
			declare: () => [],
		};
		return { construct, registered };
	}

	it('registers what a route depends on, unless the call hands it in', async () => {
		const { construct, registered } = ledger(`Ledger${Date.now()}`);
		const name = construct.service.serviceName;
		const realtime = surface();
		const which = realtime
			.route('which')
			.dependsOn([construct])
			.handle(({ services }) => services);
		const { core, write, written } = coreOf(realtime, [{ which }]);
		const frame = JSON.stringify({ action: 'which' });

		await core.message(connection, frame, write, {
			services: { [name]: { name: 'given' }, unrelated: true },
		});
		expect(registered).toEqual([]);

		await core.message(connection, frame, write);
		expect(registered).toEqual([1]);

		expect(written).toEqual([
			{ action: 'which', data: { [name]: { name: 'given' } } },
			{ action: 'which', data: { [name]: { name: 'registered' } } },
		]);
	});

	it('hands every handler a publisher over the adaptor sink, checked by the declared messages', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
			messages: { 'chat.said': z.object({ text: z.string().trim() }) },
		});
		const say = realtime
			.route('chat.say')
			.body(z.object({ text: z.string() }))
			.handle(async ({ body, sockets, connection }) => {
				await sockets.send(['other.1'], 'chat.said', { text: body.text });
				await sockets.broadcast(
					'chat.said',
					{ text: body.text },
					{ except: [connection.id] },
				);
				await sockets.close('other.2', 4000, 'kicked');
			});
		const { core, calls, write } = coreOf(realtime, [{ say }]);

		await core.message(
			connection,
			JSON.stringify({ action: 'chat.say', data: { text: ' hi ' } }),
			write,
		);

		expect(calls).toEqual({
			sent: [
				{
					ids: ['other.1'],
					payload: { action: 'chat.said', data: { text: 'hi' } },
				},
			],
			broadcasts: [
				{
					payload: { action: 'chat.said', data: { text: 'hi' } },
					except: ['test.1'],
				},
			],
			closed: [{ ids: ['other.2'], code: 4000, reason: 'kicked' }],
		});
		await expect(
			// @ts-expect-error — data its schema refuses
			core.sockets.send('other.1', 'chat.said', { text: 3 }),
		).rejects.toBeInstanceOf(InvalidWebSocketMessage);
		expect(calls.sent).toHaveLength(1);
	});
});

describe('WebSocketCore routes', () => {
	it('refuses two routes for one action, and two connect handlers', () => {
		const realtime = surface();
		const one = realtime.route('same').handle(() => 1);
		const two = realtime.route('same').handle(() => 2);
		const c1 = realtime.connect().handle(() => undefined);
		const c2 = realtime.connect().handle(() => undefined);

		expect(() => coreOf(realtime, [{ one, two }])).toThrow(
			DuplicateWebSocketRoute,
		);
		expect(() => coreOf(realtime, [{ c1, c2 }])).toThrow(
			DuplicateWebSocketRoute,
		);
	});

	it('answers only with the routes built from its own surface', async () => {
		const realtime = surface();
		const other = new WebSocketApi('Other', { path: '.', logger: silent });
		const theirs = other.route('echo').handle(() => 'theirs');
		const { sink } = recordingSink();
		const core = new WebSocketCore({
			surface: 'Realtime',
			routes: [theirs],
			sink,
			envParser: new EnvironmentParser({}),
			logger: silent,
		});
		const written: unknown[] = [];

		await core.message(connection, JSON.stringify({ action: 'echo' }), (p) =>
			written.push(JSON.parse(p)),
		);

		expect(written).toEqual([
			{ action: '$error', data: { message: "No route answers 'echo'." } },
		]);
		expect(realtime.id).toBe(core.surface);
	});
});
