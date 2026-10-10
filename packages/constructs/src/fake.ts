/**
 * Fakes: what a test stage — and `gkm dev --fake` — is handed in place of a
 * third party.
 *
 * An `ExternalApi`'s fake answers its requests and says which credentials it
 * accepts; a `Credential`'s fake is the value the test stage is handed in
 * place of the one a third party issued. Both live at `test/fakes/<id>.ts`,
 * found by convention and default-exported:
 *
 * ```ts
 * // test/fakes/polar.ts
 * export default fake.app<typeof polar>(new Hono()…, {
 *   credentials: { clientId: 'fake', clientSecret: 'fake' },
 * });
 *
 * // test/fakes/reviewer-password.ts
 * export default fake.credential<typeof reviewerPassword>(
 *   'a-reviewer-password-for-tests',
 * );
 * ```
 *
 * **The construct never names its fake**, so a fake cannot end up in a
 * deployed bundle however the bundler follows imports. gkm reads the folder
 * for `gkm test` (and the suite it starts) and for `gkm dev --fake`, and for
 * nothing that acts on a deployed stage: a deploy still refuses a stage that
 * lacks the real value.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Credential } from './credential';
import type { ExternalApi } from './external-api';

/**
 * Marks a fake. A registered symbol, so a fake built by a second copy of this
 * package — a linked workspace, two versions in a lockfile — is still one.
 */
const FAKE = Symbol.for('@geekmidas/constructs/fake');

/** Anything that answers a request — a Hono app, or a bare `{ fetch }`. */
export interface FetchHandler {
	fetch(request: Request): Response | Promise<Response>;
}

/**
 * What a construct's credentials look like going in, for a fake to supply —
 * an external API's `credentials` schema, or a credential's `schema`.
 */
type CredentialsOf<TConstruct> =
	TConstruct extends ExternalApi<string, infer TSchema, unknown>
		? StandardSchemaV1.InferInput<TSchema>
		: TConstruct extends Credential<string, infer TSchema>
			? StandardSchemaV1.InferInput<TSchema>
			: unknown;

/**
 * A third party's stand-in, as `test/fakes/<id>.ts` default-exports it.
 *
 * `credentials` are what a local or test stage is handed as `<ID>_CREDENTIALS`
 * in place of the stage's own: what an external API's fake accepts, or a
 * credential's test value.
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
	| {
			/** A `Credential`'s test value — nothing to serve. */
			readonly kind: 'credential';
	  }
);

/**
 * Build the fake `test/fakes/<id>.ts` default-exports.
 *
 * Pass the construct's type to have the value checked against its schema —
 * `fake.app<typeof polar>(…)`, `fake.credential<typeof stripe>(…)`.
 */
export const fake = {
	/** A working implementation of an external API, kept beside the tests that use it. */
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

	/** A local server an external API's provider publishes — `stripe/stripe-mock`. */
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

	/**
	 * A `Credential`'s value on the test stage and under `gkm dev --fake`, as
	 * its schema takes it — a string, or the object a JSON credential holds.
	 * It is validated where it is read, like the real one.
	 */
	credential<TCredential = unknown>(
		credentials: CredentialsOf<TCredential>,
	): Fake {
		return { [FAKE]: true, kind: 'credential', credentials };
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
