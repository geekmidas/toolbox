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
export interface Construct<
	TName extends string = string,
	TClient = never,
> {
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
export type Infer<C> = C extends Construct<string, infer TClient>
	? TClient
	: never;

/** A construct's canonical id. */
export type NameOf<C> = C extends Construct<infer TName, unknown>
	? TName
	: never;
