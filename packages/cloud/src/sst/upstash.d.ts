/**
 * The slice of Upstash's provider this package uses.
 *
 * SST preloads AWS and Cloudflare and installs everything else on demand — `sst
 * add upstash` — which "adds the namespace of the provider to your globals".
 * So at runtime this global exists in an app that ran the command and does not
 * in one that did not, and there is no package here to import types from.
 *
 * Declared rather than depended on, for the same reason `sst.aws.*` is: taking
 * `@upstash/pulumi` as a real dependency would install a provider for every
 * consumer, including the ones caching in Postgres.
 *
 * Narrow on purpose. It describes what `Cache` reads and nothing else, so it
 * cannot drift into claiming knowledge of an API this package does not use.
 */
declare namespace upstash {
	class RedisDatabase {
		constructor(
			name: string,
			args: {
				databaseName: $util.Input<string>;
				/** A region name, or `global` with `primaryRegion` set alongside it. */
				region: $util.Input<string>;
				primaryRegion?: $util.Input<string>;
				tls?: $util.Input<boolean>;
				eviction?: $util.Input<boolean>;
			},
			opts?: unknown,
		);

		/** The host to reach it on. Not a URL despite the name — no scheme. */
		readonly endpoint: $util.Output<string>;
		/** The bearer token the HTTP client sends. */
		readonly restToken: $util.Output<string>;
		readonly readOnlyRestToken: $util.Output<string>;
		readonly port: $util.Output<number>;
	}
}
