/**
 * `StaticSite` — a frontend, declared like anything else.
 *
 * The point is not that a site needs provisioning; it is that a site is the
 * *consumer* whose edges make four hand-maintained lists derivable. Declaring it
 * is what turns "which origins does the API allow" from something a person keeps
 * in step into something the graph already knows.
 *
 * ```ts
 * export const console = new StaticSite('Console', { path: 'apps/console' })
 *   .dependsOn([api, auth]);
 * ```
 *
 * It has no `.service`. A site is not a process that registers clients — it is
 * built, and the values it needs are inlined or fetched by its own framework —
 * so the edge is {@link Declarable} rather than {@link Consumable}, and the
 * asymmetry is the honest one: a site consumes addresses, not connections.
 *
 * Only the static variant ships. SSR deploy shapes are unstable and each one is
 * its own maintenance, so they follow rather than arrive together; Expo and
 * mobile are out of scope entirely, because an app store is not infrastructure
 * and there is no URL to hand anyone.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
	provideKey,
	type SiteDeclaration,
} from '@geekmidas/manifest';
import { type Declarable, edgeTo } from './construct-interface';

export interface StaticSiteConfig {
	/** Where its source lives, relative to the workspace root. */
	path: string;
	/**
	 * Which framework builds it.
	 *
	 * It selects how values are delivered — `VITE_`, `NEXT_PUBLIC_`, a fetched
	 * `config.json` — and never which values there are. One neutral name from the
	 * construct, one serialisation per framework, the same rule as everywhere
	 * else.
	 */
	variant?: SiteDeclaration['variant'];
}

export class StaticSite<TName extends string = string>
	implements Declarable<TName>
{
	readonly id: TName;
	readonly keys: { url: string };

	constructor(
		id: ConstructName<TName>,
		private readonly config: StaticSiteConfig,
		/**
		 * Internal: how `.dependsOn()` carries edges into the copy it returns.
		 * Written as a parameter rather than a mutable field so the builder can
		 * stay immutable without a clone method, the same shape
		 * `KyselyDatabase` uses for its derived forms.
		 */
		private readonly dependencies: readonly Dependency[] = [],
	) {
		this.id = canonicalId(id as string) as TName;
		this.keys = { url: provideKey(this.id, 'url') };
	}

	/**
	 * What this site calls.
	 *
	 * Immutable, like every other builder here: it returns a new site rather than
	 * mutating this one, so a module that exports both a base and a variant of it
	 * cannot have the second silently change the first.
	 *
	 * Takes {@link Declarable} rather than {@link Consumable} because a site's
	 * edge is a build-time link and not a service injection — requiring a client
	 * would exclude exactly the surfaces a frontend actually depends on.
	 */
	dependsOn(constructs: readonly Declarable[]): StaticSite<TName> {
		return new StaticSite<TName>(this.id as ConstructName<TName>, this.config, [
			...this.dependencies,
			...constructs.map(edgeTo),
		]);
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'site',
				id: this.id,
				variant: this.config.variant ?? 'static',
				path: this.config.path,
				dependencies: this.dependencies,
				provides: [this.keys.url],
			},
		];
	}
}
