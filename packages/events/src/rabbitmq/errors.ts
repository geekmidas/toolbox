// Beside the adapter but apart from its connection module, which imports
// the broker's client: the publisher and subscriber load that lazily, and
// importing an error class from it would load it eagerly.

/** The connection opened but has no channel to publish or consume on. */
export class RabbitMQChannelUnavailable extends Error {
	constructor() {
		super(
			'RabbitMQ connected without a channel. Check the broker is reachable and the connection string names a vhost the user can open channels on.',
		);
		this.name = 'RabbitMQChannelUnavailable';
	}
}
