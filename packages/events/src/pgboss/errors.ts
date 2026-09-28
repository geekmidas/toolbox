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
