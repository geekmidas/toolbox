/**
 * `ExternalApi` — an HTTP API somebody else runs.
 *
 * Polar, Stripe, a payment gateway: nothing to provision, but an address that
 * changes by stage and credentials the provider issued for each one. Without a
 * construct every integration writes that switching by hand — an optional
 * `POLAR_URL`, a fake started somewhere, a client built in a service — and the
 * target cannot see any of it.
 *
 * ```ts
 * // constructs/polar.ts
 * export const polar = new ExternalApi('Polar', {
 *   url: 'https://www.polaraccesslink.com',
 *   credentials: z.object({ clientId: z.string(), clientSecret: z.string() }),
 *   client: ({ url, credentials }) => new PolarClient(url, credentials),
 * });
 *
 * // test/fakes/polar.ts
 * export default fake.app(new Hono().post('/v3/oauth2/token', …), {
 *   credentials: { clientId: 'fake', clientSecret: 'fake' },
 * });
 *
 * // in a handler — the real API deployed, the fake locally and in tests
 * .dependsOn([polar])
 * .handle(({ services }) => services.polar.exchangeCode(code))
 * ```
 *
 * Deployed, the URL is `url` — one for every stage, or one per stage name with
 * a `default` — and the credentials are the stage's `<ID>_CREDENTIALS`, one
 * JSON value read the way a `Credential`'s is. Locally and in tests both come
 * from the fake.
 *
 * **The construct never names its fake.** It is found by convention, at
 * `test/fakes/<id>.ts`, and read only by gkm and the generated test harness —
 * so a fake, and the recorded responses it answers from, cannot end up in a
 * deployed bundle however the bundler follows imports.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Consumable } from './construct-interface';
import { readCredentials } from './credential';

/** What a credentials schema yields. */
type Value<TSchema extends StandardSchemaV1> =
	StandardSchemaV1.InferOutput<TSchema>;

export interface ExternalApiOptions<TSchema extends StandardSchemaV1, TClient> {
	/**
	 * Where it answers deployed: one URL for every stage, or one per stage
	 * name, with `default` for any stage not listed.
	 */
	url: string | Readonly<Record<string, string>>;
	/** What the stage's `<ID>_CREDENTIALS` must look like. */
	credentials: TSchema;
	/** What a handler is handed, built from where it answers and the credentials. */
	client: (connection: {
		url: string;
		credentials: Value<TSchema>;
	}) => TClient | Promise<TClient>;
}

export class ExternalApi<
	TName extends string = string,
	TSchema extends StandardSchemaV1 = StandardSchemaV1,
	TClient = unknown,
> implements Consumable<TName, TClient>
{
	// `Consumable` for the reason `Credential` gives: a client generic in
	// `TClient` cannot satisfy `Construct`'s conditional service type.
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, TClient>;

	/** Read by both `declare()` and `connect()`, so the two cannot drift. */
	private readonly keys: { url: string; credentials: string };

	/** The promise, so concurrent registrations share one client. */
	private connected?: Promise<TClient>;

	constructor(
		id: ConstructName<TName>,
		private readonly options: ExternalApiOptions<TSchema, TClient>,
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.keys = {
			url: provideKey(canonical, 'url'),
			credentials: provideKey(canonical, 'credentials'),
		};

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (registerOptions) => {
				this.connected ??= this.connect(registerOptions);
				return this.connected;
			},
		};
	}

	/**
	 * What the stage's `<ID>_CREDENTIALS` must look like — the schema the value
	 * is validated against where it is read. Public so a tool setting the value
	 * (`gkm secrets:add`) can check it, and describe its fields, before it is
	 * stored rather than at the first request.
	 */
	get credentialsSchema(): TSchema {
		return this.options.credentials;
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'external-api',
				id: this.id,
				url: this.options.url,
				provides: [this.keys.url, this.keys.credentials],
			},
		];
	}

	private async connect(options: ServiceRegisterOptions): Promise<TClient> {
		const { url } = options.envParser
			.create((get) => ({ url: get(this.keys.url).string() }))
			.parse();
		const credentials = await readCredentials(
			this.id,
			this.keys.credentials,
			this.options.credentials,
			options.envParser,
		);

		return this.options.client({ url, credentials });
	}
}

/** Anything that answers a request — a Hono app, or a bare `{ fetch }`. */
export interface FetchHandler {
	fetch(request: Request): Response | Promise<Response>;
}

/**
 * Marks a fake. A registered symbol, so a fake built by a second copy of this
 * package — a linked workspace, two versions in a lockfile — is still one.
 */
const FAKE = Symbol.for('@geekmidas/constructs/fake');

/** What an external API's credentials look like going in, for a fake to supply. */
type CredentialsOf<TApi> =
	TApi extends ExternalApi<string, infer TSchema, unknown>
		? StandardSchemaV1.InferInput<TSchema>
		: unknown;

/**
 * An external API's stand-in, as `test/fakes/<id>.ts` default-exports it.
 *
 * `credentials` are what the fake accepts, and what a local or test stage is
 * handed as `<ID>_CREDENTIALS` in place of the stage's own.
 */
export type Fake = {
	readonly [FAKE]: true;
	readonly credentials: unknown;
} & (
	| {
			readonly kind: 'app';
			/** Served by gkm: in-process in a test, on its own port in `gkm dev`. */
			readonly handler: FetchHandler;
	  }
	| {
			readonly kind: 'image';
			/** The provider's own local server, run as a container. */
			readonly image: string;
			/** The port it listens on inside the container. */
			readonly port: number;
	  }
);

/**
 * Build the fake `test/fakes/<id>.ts` default-exports.
 *
 * Pass the API's type to have the credentials checked against its schema —
 * `fake.app<typeof polar>(…)`.
 */
export const fake = {
	/** A working implementation of the API, kept beside the tests that use it. */
	app<TApi = unknown>(
		handler: FetchHandler,
		options: { credentials: CredentialsOf<TApi> },
	): Fake {
		return {
			[FAKE]: true,
			kind: 'app',
			handler,
			credentials: options.credentials,
		};
	},

	/** A local server the provider publishes — `stripe/stripe-mock`. */
	image<TApi = unknown>(
		image: string,
		options: { port: number; credentials: CredentialsOf<TApi> },
	): Fake {
		return {
			[FAKE]: true,
			kind: 'image',
			image,
			port: options.port,
			credentials: options.credentials,
		};
	},
};

/** Whether a value is a fake — what gkm asks of a `test/fakes` default export. */
export function isFake(value: unknown): value is Fake {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { [FAKE]?: unknown })[FAKE] === true
	);
}
