/**
 * Type-level tests for a WebSocket surface's publisher and its routes.
 *
 * The frame shape is a wire concern: `send(ids, action, data)` is typed by the
 * declared messages the same way whether frames are `{ action, data }` or flat
 * under a discriminator. The runtime half is in `websocket/__tests__`.
 *
 * Type-checked, never executed.
 */

import { z } from 'zod';
import { KyselyDatabase } from '../database/kysely';
import {
	type MessageAction,
	type MessageData,
	WebSocketApi,
	type WebSocketPublisher,
} from '../websocket-api';

type Expect<T extends true> = T;
type Equals<A, B> =
	(<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
		? true
		: false;

const messages = {
	'chat.message.created': z.object({
		chatId: z.string(),
		message: z.object({ text: z.string() }),
	}),
	'scan.result': z.object({ ok: z.boolean() }),
};

const nested = new WebSocketApi('Nested', { path: '.', messages });
const flat = new WebSocketApi('Flat', {
	path: '.',
	frame: { discriminator: 'type' },
	messages,
});

/** What `services.<id>` is in a handler that depends on the surface. */
type PublisherOf<T extends { service: { register: (...args: any[]) => any } }> =
	Awaited<ReturnType<T['service']['register']>>;

type NestedPublisher = PublisherOf<typeof nested>;
type FlatPublisher = PublisherOf<typeof flat>;

/** The frame does not change what the publisher is. */
type _SamePublisher = Expect<Equals<NestedPublisher, FlatPublisher>>;
type _IsPublisher = Expect<
	Equals<FlatPublisher, WebSocketPublisher<typeof messages>>
>;

/** Its actions are the declared ones. */
type _Actions = Expect<
	Equals<MessageAction<typeof messages>, 'chat.message.created' | 'scan.result'>
>;

/** And each action's data is its schema's input. */
type _Data = Expect<
	Equals<
		MessageData<typeof messages, 'chat.message.created'>,
		{ chatId: string; message: { text: string } }
	>
>;

declare const publisher: FlatPublisher;

void publisher.send('id', 'chat.message.created', {
	chatId: 'c1',
	message: { text: 'hi' },
});
void publisher.broadcast('scan.result', { ok: true });

// @ts-expect-error — an action it does not declare
void publisher.send('id', 'chat.message.deleted', { chatId: 'c1' });

// @ts-expect-error — data its schema does not take
void publisher.send('id', 'scan.result', { ok: 'yes' });

// @ts-expect-error — the action is not data: flat frames are still sent as (action, data)
void publisher.broadcast({ type: 'scan.result', ok: true });

/**
 * A route's `.dependsOn()` types its handler's `services` as an endpoint's
 * does: each construct's client under its own id. `T` is inferred as a
 * readonly tuple, and gating the services on `extends Service[]` once typed
 * them all away.
 */
interface UsersDB {
	users: { id: string };
}

const database = new KyselyDatabase<UsersDB, 'Database'>('Database');
const cache = new KyselyDatabase<UsersDB, 'Cache'>('Cache');

type DatabaseClient = Awaited<
	ReturnType<(typeof database)['service']['register']>
>;

nested
	.connect()
	.dependsOn([database])
	.handle(({ services }) => {
		type _Typed = Expect<Equals<typeof services.database, DatabaseClient>>;
		return undefined;
	});

nested
	.disconnect()
	.dependsOn([database])
	.handle(({ services }) => {
		type _Typed = Expect<Equals<typeof services.database, DatabaseClient>>;
	});

nested
	.route('chat.send')
	.dependsOn([database])
	.dependsOn([cache])
	.handle(({ services }) => {
		type _Typed = Expect<Equals<typeof services.database, DatabaseClient>>;
		// Repeated calls accumulate, as an endpoint's do.
		void services.cache;
		// @ts-expect-error — only what the route depends on is there
		void services.storage;
	});
