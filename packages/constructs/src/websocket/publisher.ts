import {
	type Delivery,
	EVERY_INSTANCE,
	type WebSocketTransport,
} from './transport';

/** The instance a connection id was issued by: everything before its dot. */
export function instanceOf(connectionId: string): string | undefined {
	const dot = connectionId.indexOf('.');
	return dot > 0 ? connectionId.slice(0, dot) : undefined;
}

/**
 * How anything reaches a socket — `services.realtime` in an endpoint, and
 * `sockets` in a route of the surface itself.
 *
 * A message is any JSON value; it is serialised once, whatever the number of
 * sockets it goes to. An id whose process has gone is dropped silently, as
 * API Gateway's `postToConnection` to a closed connection is a no-op the
 * sender rarely wants to handle.
 */
export class WebSocketPublisher {
	constructor(
		private readonly transport: WebSocketTransport,
		/**
		 * Delivers to this process's own sockets without a round trip through
		 * the transport — set on the server's own publisher.
		 */
		private readonly local?: {
			instance: string;
			deliver(delivery: Delivery): void;
		},
	) {}

	/** Send `message` to each connection. */
	async send(ids: string | readonly string[], message: unknown): Promise<void> {
		const payload = JSON.stringify(message);
		await this.each(ids, (group) => ({ kind: 'send', ids: group, payload }));
	}

	/** Send `message` to every open connection, on every process. */
	async broadcast(
		message: unknown,
		options: { except?: readonly string[] } = {},
	): Promise<void> {
		const payload = JSON.stringify(message);
		await this.transport.publish(EVERY_INSTANCE, {
			kind: 'broadcast',
			payload,
			...(options.except?.length ? { except: options.except } : {}),
		});
	}

	/** Close each connection, with a close code and reason its client sees. */
	async close(
		ids: string | readonly string[],
		code = 1000,
		reason = '',
	): Promise<void> {
		await this.each(ids, (group) => ({
			kind: 'close',
			ids: group,
			code,
			reason,
		}));
	}

	/** One delivery per process that holds any of `ids`. */
	private async each(
		ids: string | readonly string[],
		delivery: (group: string[]) => Delivery,
	): Promise<void> {
		const byInstance = new Map<string, string[]>();
		for (const id of typeof ids === 'string' ? [ids] : ids) {
			const instance = instanceOf(id);
			if (!instance) continue;
			const group = byInstance.get(instance) ?? [];
			group.push(id);
			byInstance.set(instance, group);
		}

		await Promise.all(
			[...byInstance].map(([instance, group]) =>
				this.local?.instance === instance
					? this.local.deliver(delivery(group))
					: this.transport.publish(instance, delivery(group)),
			),
		);
	}
}
