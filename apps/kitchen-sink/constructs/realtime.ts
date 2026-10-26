import { WebSocketApi } from '@geekmidas/constructs/websocket-api';
import { z } from 'zod';
import { auth } from './auth.js';
import { logger } from './logger.js';
import { telemetry } from './telemetry.js';

/**
 * The application's realtime surface: one long-lived connection per signed-in
 * client, in a container of its own.
 *
 * A frame is routed on its `action`, and the connection's lifecycle runs
 * `connect()` and `disconnect()`. Nothing else holds a socket, so an endpoint
 * that wants to reach one names this surface — `.dependsOn([realtime])` — and
 * sends through `services.realtime`; whichever replica holds the socket
 * delivers, over the stack's Redis.
 *
 * Two replicas, because Node runs one thread and each process behind the edge
 * has a budget of connections of its own.
 *
 * `messages` is everything it sends its sockets: `broadcast` and `send` are
 * typed by it, and each message's data is checked before it goes out.
 */
export const realtime = new WebSocketApi('Realtime', {
	path: 'apps/realtime',
	replicas: 2,
	messages: {
		announcement: z.object({ text: z.string() }),
		'chat.said': z.object({ from: z.string(), text: z.string() }),
	},
	logger,
	telemetry,
}).auth(auth);
