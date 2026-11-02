import { describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { InvalidWebSocketMessage } from '../../websocket/publisher';
import { WebSocketApi } from '../../websocket-api';
import { featureTest, UnknownWebSocketApi } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * What a test sends a WebSocket surface's sockets is recorded, per test, as
 * what it publishes to a topic is: an endpoint that `.dependsOn([realtime])`
 * is handed a recorder, and `sockets(realtime)` reads it back.
 */

const realtime = new WebSocketApi('Realtime', {
	path: '.',
	frame: { discriminator: 'type' },
	messages: {
		'chat.message.created': z.object({ chatId: z.string(), text: z.string() }),
	},
});
const other = new WebSocketApi('Other', { path: '.' });

const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });

const postMessage = api
	.post('/chats/:chatId/messages')
	.dependsOn([realtime])
	.params(z.object({ chatId: z.string() }))
	.body(z.object({ to: z.array(z.string()), text: z.unknown() }))
	.output(z.object({ ok: z.boolean() }))
	.handle(async ({ params, body, services }) => {
		await services.realtime.send(body.to, 'chat.message.created', {
			chatId: params.chatId,
			text: body.text as string,
		});
		return { ok: true };
	});

const source = (file: string, name: string) => ({ file, export: name });

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Realtime: {
			kind: 'websocket-api',
			source: source('constructs', 'realtime'),
		},
	},
	endpoints: [{ surface: 'Api', source: source('endpoints', 'postMessage') }],
	env: { API_URL: 'http://api.sockets.test' },
};

const it = featureTest({
	manifest,
	modules: {
		constructs: { realtime },
		endpoints: { postMessage },
	},
});

const post = (
	browser: { fetch: typeof fetch },
	body: { to: string[]; text: unknown },
) =>
	browser.fetch('http://api.sockets.test/chats/c1/messages', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	});

describe('featureTest sockets(surface)', () => {
	it('records what an endpoint sent through services.<surface>', async ({
		browser,
		sockets,
	}) => {
		const response = await post(browser, { to: ['a.1', 'b.2'], text: 'hi' });
		expect(response.status).toBe(200);

		expect(sockets(realtime).sent).toEqual([
			{
				ids: ['a.1', 'b.2'],
				action: 'chat.message.created',
				data: { chatId: 'c1', text: 'hi' },
				frame: { type: 'chat.message.created', chatId: 'c1', text: 'hi' },
			},
		]);
	});

	it('starts each test with nothing recorded', async ({ sockets }) => {
		expect(sockets(realtime).sent).toEqual([]);
	});

	it('fails the request whose push the declared messages refuse', async ({
		browser,
		sockets,
		services,
	}) => {
		const response = await post(browser, { to: ['a.1'], text: 42 });
		expect(response.status).toBe(500);
		expect(sockets(realtime).sent).toEqual([]);

		// The recorder is the service a handler gets.
		const publisher = await services.get('realtime');
		expect(publisher).toBe(sockets(realtime));
		await expect(
			sockets(realtime).send('a.1', 'chat.message.created', {
				chatId: 'c1',
				text: 1 as never,
			}),
		).rejects.toBeInstanceOf(InvalidWebSocketMessage);
	});

	it('names a surface the manifest does not declare', async ({ sockets }) => {
		expect(() => sockets(other)).toThrow(UnknownWebSocketApi);
	});
});
