/**
 * The construct contract.
 *
 * A construct is three things at once — an infrastructure requirement at build
 * time, a runtime capability, and something other code can consume — which is
 * what forces exactly these three members.
 *
 * An **interface**, not a base class: `Endpoint`, `Cron`, `Queue`, and `Topic`
 * can satisfy it without inheritance surgery, a lifted `Service` can satisfy it
 * as a plain object, and `.dependsOn()` gets its enforcement structurally — a
 * `Service` (`{ serviceName, register }`) simply does not match
 * `{ id, declare, service }`, with no `instanceof` anywhere.
 *
 * Lives in its own module while the existing abstract `Construct` class is
 * still in use; it takes that name once the class is gone.
 */

import type { Declaration } from '@geekmidas/manifest';
import type { Service } from '@geekmidas/services';

/**
 * @typeParam TName - the construct's canonical id, PascalCase. Keeping it a
 * literal is what lets the service key be `Uncapitalize<TName>` — a TypeScript
 * intrinsic, so no custom transform needs a runtime twin.
 * @typeParam TClient - what consuming this construct hands you. `never` means it
 * owns no address and cannot be consumed: a `Cron` is fired by a schedule and a
 * `Subscriber` is reached through its topic, so `.dependsOn()` on either is a
 * compile error rather than a stub that throws.
 */
export interface Construct<TName extends string = string, TClient = never> {
	/** Canonical, PascalCase, unique within the manifest. */
	readonly id: TName;

	/**
	 * The build-time face: what this construct contributes to the manifest.
	 *
	 * Returns an array because some constructs contribute more than one node — a
	 * queue declares the queue and its worker, a database declares its migrator
	 * and seeder. Most return one.
	 */
	declare(): Declaration[];

	/**
	 * The consumable face — the address this construct owns, as a client.
	 *
	 * A field assigned once rather than a getter. `Construct.getEnvironment`
	 * caches by service *object*, and `Topic.publisher` returns a fresh literal
	 * on every access, so that cache never hits for topics or queues today.
	 */
	readonly service: [TClient] extends [never]
		? never
		: Service<Uncapitalize<TName>, TClient>;
}

/** What consuming a construct hands you. */
export type Infer<C> =
	C extends Construct<string, infer TClient> ? TClient : never;

/** A construct's canonical id. */
export type NameOf<C> =
	C extends Construct<infer TName, unknown> ? TName : never;

/**
 * What `.dependsOn([…])` accepts: a construct that owns a client.
 *
 * Structural, and deliberately narrower than {@link Construct} — it is the
 * face a *consumer* needs, so the builders can accept a database, a bucket, a
 * mail sender, a queue, or a topic without importing any of them. A plain
 * `Service` is not one of these, which is the point: constructs-only confines
 * env sniffing to `.services()` and the explicit lift, so retiring that method
 * retires implicit inference with it.
 */
export interface Consumable<TName extends string = string, TClient = unknown> {
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, TClient>;
	declare(): Declaration[];
}

/**
 * The services a list of constructs dissolves into.
 *
 * A mapped tuple, so `[db, uploads]` types as `[Service<'orders', Kysely<DB>>,
 * Service<'uploads', StorageClient>]` and the handler's service record gains
 * both keys — the same machinery `.services()` already uses, which is why
 * `dependsOn` needs no type plumbing of its own.
 */
export type ServicesOf<T extends readonly Consumable[]> = {
	[K in keyof T]: T[K]['service'];
};

/**
 * The services of a list of constructs, at runtime.
 *
 * @throws {NotAConstruct} when handed something else. The type already refuses
 * it, but a JavaScript caller gets no such warning, and a `Service` slipping
 * through would fail later as an undefined key in the handler.
 */
export function servicesOf<const T extends readonly Consumable[]>(
	constructs: T,
): ServicesOf<T> {
	return constructs.map((construct) => {
		if (!isConsumable(construct)) throw new NotAConstruct(construct);

		return construct.service;
	}) as ServicesOf<T>;
}

/** Something that is not a construct was passed to `.dependsOn()`. */
export class NotAConstruct extends Error {
	constructor(readonly value: unknown) {
		const name =
			typeof value === 'object' && value !== null && 'serviceName' in value
				? `the service '${String((value as { serviceName: unknown }).serviceName)}'`
				: `a ${typeof value}`;

		super(
			`.dependsOn() takes constructs, and was given ${name}. ` +
				`Pass it to .services([…]) instead, or lift it with ` +
				`Construct.fromService().`,
		);
		this.name = 'NotAConstruct';
	}
}

/**
 * Whether a value is a construct rather than a bare `Service`.
 *
 * Structural rather than `instanceof`: a construct from a second copy of
 * `@geekmidas/constructs` — a linked workspace, two versions in a lockfile — is
 * still a construct, and `instanceof` is exactly the check that says otherwise.
 */
export function isConsumable(value: unknown): value is Consumable {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Partial<Consumable>;

	return (
		typeof candidate.id === 'string' &&
		typeof candidate.declare === 'function' &&
		typeof (candidate.service as Service | undefined)?.serviceName === 'string'
	);
}

/**
 * The service behind either face.
 *
 * `.database()` and the publisher slots take a construct now; they took a
 * `Service` before and still do, because a hand-written one is exactly what
 * `Construct.fromService` exists to lift and not everything has been lifted.
 */
export function serviceOf<TName extends string, TClient>(
	source: Consumable<TName, TClient> | Service<TName, TClient>,
): Service<TName, TClient> {
	// A construct's service key is `Uncapitalize<TName>` and the slot is typed
	// by `TName`; the two describe the same key, and only the cast says so.
	return isConsumable(source)
		? (source.service as unknown as Service<TName, TClient>)
		: (source as Service<TName, TClient>);
}
