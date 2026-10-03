// Beside the adapter but apart from its connection module, which imports
// the broker's client: the publisher and subscriber load that lazily, and
// importing an error class from it would load it eagerly.

/** pg-boss connected but its instance never started. */
export class PgBossNotStarted extends Error {
	constructor() {
		super(
			'pg-boss did not start. Check the database in the connection string is reachable and the role may create the pg-boss schema.',
		);
		this.name = 'PgBossNotStarted';
	}
}

/** A topic subscription with no name to give the subscriber's own queue. */
export class PgBossSubscriptionNeedsName extends Error {
	constructor(readonly topic: string) {
		super(
			`Subscribing to topic '${topic}' on pg-boss needs a subscription name: ` +
				'each subscriber drains a queue of its own, and that queue is named ' +
				'for it. Pass `subscription`.',
		);
		this.name = 'PgBossSubscriptionNeedsName';
	}
}
