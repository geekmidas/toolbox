import { UnauthorizedError } from '@geekmidas/errors';
import { realtime } from '@kitchen-sink/constructs/realtime.js';
import { z } from 'zod';

/**
 * Who the connection is for, from the session the auth server verified. What
 * it returns is the connection's `data` in every later frame.
 */
export const connect = realtime.connect().handle(({ session }) => {
	const user = (session as { user?: { id: string } } | null)?.user;
	if (!user) throw new UnauthorizedError('Sign in to connect.');
	return { userId: user.id };
});

/** A message to everyone else connected, on any replica. */
export const say = realtime
	.route('chat.say')
	.body(z.object({ text: z.string().min(1).max(500) }))
	.handle(async ({ body, connection, sockets }) => {
		await sockets.broadcast(
			{
				action: 'chat.said',
				data: { from: connection.data.userId, text: body.text },
			},
			{ except: [connection.id] },
		);
		return { sent: true };
	});
