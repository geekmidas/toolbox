/**
 * `Credential` — a third-party credential with a shape.
 *
 * The answer to the design's first open question, "where does `Secret` sit?".
 * It sits beside a secret rather than replacing it, because the two differ by
 * *lifecycle* and that is the only difference worth two kinds for: a secret is
 * generated and rotated by the platform and is one opaque string, while a
 * credential is issued by someone else, arrives with several fields, and is
 * worth validating on the way in.
 *
 * ```ts
 * export const stripe = new Credential('Stripe', {
 *   schema: z.object({ secretKey: z.string(), webhookSecret: z.string() }),
 * });
 *
 * // in a handler — no await, already parsed and validated
 * services.stripe.secretKey
 * ```
 *
 * **Nothing about it is async at the call site**, which is the part that looks
 * like it should be hard and is not. `Service.register()` may return a promise
 * and `ServiceDiscovery` awaits every one before a handler runs, so fetching a
 * value and validating it — including when a StandardSchema's `~standard.validate`
 * returns a promise of its own — both happen inside that existing seam.
 *
 * **One key holding JSON, not one key per field.** That is the shape a secret
 * manager stores, and it is the only shape that works with an arbitrary
 * StandardSchema: the spec has no introspection API, so enumerating a schema's
 * fields means reaching into one library's internals (`.shape`) and being wrong
 * for every other.
 *
 * **A test stage is handed a fake.** Nobody issues a credential to a test
 * stage set up fresh — CI's auto-setup stores no third party's values — so a
 * credential a test reaches has a fake at `test/fakes/<id>.ts`, the folder an
 * `ExternalApi`'s fake lives in:
 *
 * ```ts
 * // test/fakes/stripe.ts
 * import { fake } from '@geekmidas/constructs/credential';
 * import type { stripe } from '../../constructs/stripe';
 *
 * export default fake.credential<typeof stripe>({
 *   secretKey: 'sk_test_fake',
 *   webhookSecret: 'whsec_fake',
 * });
 * ```
 *
 * gkm reads it for `gkm test` and `gkm dev --fake` only, and the construct
 * never names it, so it is in no deployed bundle and a deploy still refuses a
 * stage without the real value.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import { parseSchema } from '@geekmidas/schema/parser';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Consumable } from './construct-interface';

/** What a credential's schema yields. */
type Value<TSchema extends StandardSchemaV1> =
	StandardSchemaV1.InferOutput<TSchema>;

export interface CredentialOptions<TSchema extends StandardSchemaV1> {
	/**
	 * What the credential must look like.
	 *
	 * Validated at registration, so a malformed or half-set credential fails
	 * when the process starts rather than on the first request that needs the
	 * one field somebody forgot.
	 */
	schema: TSchema;
	/**
	 * Re-resolve on every registration instead of once per process.
	 *
	 * Off by default: a credential is resolved once and reused, because the
	 * alternative is a fetch on every request. The cost of that default is that
	 * a rotated credential needs a restart, which is the right trade for a value
	 * that changes a few times a year — and this is the escape hatch for when it
	 * is not.
	 */
	refresh?: boolean;
}

export class Credential<
	TName extends string = string,
	TSchema extends StandardSchemaV1 = StandardSchemaV1,
> implements Consumable<TName, Value<TSchema>>
{
	// `Consumable` rather than `Construct`, and not by preference: `Construct`
	// types its service as `[TClient] extends [never] ? never : Service<…>` so
	// that a `Cron` cannot be depended on, and TypeScript cannot evaluate that
	// conditional while `TClient` is still a type parameter. Every construct
	// with a concrete client satisfies `Construct`; the first one whose client
	// is generic cannot. `Consumable` is the face `.dependsOn()` requires and
	// carries no conditional, so it is the honest annotation here.
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, Value<TSchema>>;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the key the
	 * target publishes and the key the client reads cannot drift.
	 */
	private readonly keys: { credentials: string };

	/**
	 * The resolved value, held as the *promise* rather than the value.
	 *
	 * Caching the promise is what makes two concurrent registrations share one
	 * resolution: caching the value would let both start before either finished,
	 * which is a duplicated fetch every cold start rather than never.
	 */
	private resolved?: Promise<Value<TSchema>>;

	constructor(
		id: ConstructName<TName>,
		private readonly options: CredentialOptions<TSchema>,
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.keys = { credentials: provideKey(canonical, 'credentials') };

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (registerOptions) => this.connect(registerOptions),
		};
	}

	/**
	 * What the stage's `<ID>_CREDENTIALS` must look like — the schema the value
	 * is validated against where it is read. Public so a tool setting the value
	 * (`gkm secrets:add`) can check it, and describe its fields, before it is
	 * stored rather than at the first request.
	 */
	get credentialsSchema(): TSchema {
		return this.options.schema;
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'credential',
				id: this.id,
				provides: [this.keys.credentials],
			},
		];
	}

	private connect(options: ServiceRegisterOptions): Promise<Value<TSchema>> {
		if (this.options.refresh) return this.resolve(options);

		this.resolved ??= this.resolve(options);

		return this.resolved;
	}

	private resolve(options: ServiceRegisterOptions): Promise<Value<TSchema>> {
		return readCredentials(
			this.id,
			this.keys.credentials,
			this.options.schema,
			options.envParser,
		);
	}
}

/**
 * A credentials key, read and validated against its schema.
 *
 * Shared with every construct that holds a third party's credentials — an
 * `ExternalApi` reads its own the same way — so the shape a stage stores and
 * the error a bad value raises are the same everywhere.
 *
 * @throws {MalformedCredential} when the value is not what the schema says.
 */
export async function readCredentials<TSchema extends StandardSchemaV1>(
	id: string,
	key: string,
	schema: TSchema,
	envParser: ServiceRegisterOptions['envParser'],
): Promise<Value<TSchema>> {
	const { raw } = envParser
		.create((get) => ({ raw: get(key).string() }))
		.parse();

	try {
		return await parseSchema(schema, decodeCredentials(raw));
	} catch (issues) {
		throw new MalformedCredential(id, key, issues);
	}
}

/**
 * The raw environment value as the thing the schema should see.
 *
 * JSON when it is JSON, and the string itself when it is not — a credential
 * with a single opaque field is ordinary, and requiring `"…"` around it would
 * be ceremony that every operator setting one by hand would get wrong once.
 *
 * Exported so a tool checking a value before it is stored reads it exactly as
 * the process that uses it will.
 */
export function decodeCredentials(raw: string): unknown {
	const value = raw.startsWith(JSON_SCHEME)
		? raw.slice(JSON_SCHEME.length)
		: raw;

	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/**
 * The explicit form, for the case a credential legitimately *is* a JSON string
 * and must not be parsed into an object. Rare, and cheaper to support than to
 * explain.
 */
const JSON_SCHEME = 'json:';

/** A credential was set, and is not what its schema says it should be. */
export class MalformedCredential extends Error {
	constructor(
		readonly id: string,
		readonly key: string,
		readonly issues: unknown,
	) {
		super(
			`${key} is not a valid ${id} credential. ` +
				`It is validated where it is read, so this is the value that is set ` +
				`rather than the code that uses it: ${describe(issues)}`,
		);
		this.name = 'MalformedCredential';
	}
}

/** StandardSchema issues as one line. */
function describe(issues: unknown): string {
	if (!Array.isArray(issues)) return String(issues);

	return issues
		.map((issue: StandardSchemaV1.Issue) => {
			const path = issue.path
				?.map((segment) =>
					typeof segment === 'object' ? String(segment.key) : String(segment),
				)
				.join('.');

			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join('; ');
}

export { type Fake, fake, isFake } from './fake';
