/**
 * `MobileApp` — an Expo app, declared like a site.
 *
 * Its edges are the point, as a site's are. One `.dependsOn([api, auth])` is
 * the fact behind everything a mobile app otherwise has written down by hand:
 *
 * - its `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_URL`, which locally are
 *   the servers' own ports — reachable once the app swaps `localhost` for the
 *   address Metro is served from, which is what makes a phone on the LAN work;
 * - its URL scheme, per stage (`shop`, or `shop-dev` locally), so a
 *   development build and the store build on one phone never share links;
 * - the scheme in the auth server's and the API's trusted origins — and, on a
 *   local stage, the `exp://` origins Expo Go sends from;
 * - Better Auth's Expo plugin on the auth server, and sign-in links an app asks
 *   for built on an address the phone can open.
 *
 * ```ts
 * export const app = new MobileApp('App', { path: 'apps/app' })
 *   .dependsOn([api, auth]);
 * ```
 *
 * Like a site it has no `.service`: it is built by its own toolchain, and
 * consumes addresses rather than connections. Nothing deploys it — EAS and the
 * stores do — so the targets derive *for* it and never run it.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	type Dependency,
	type MobileAppDeclaration,
	provideKey,
} from '@geekmidas/manifest';
import { type Declarable, edgeTo } from './construct-interface';

export interface MobileAppConfig {
	/**
	 * Where its source lives, relative to the workspace root — `'apps/app'`.
	 * Required, the same field a site and a surface take.
	 */
	path: string;
	/**
	 * Which toolchain builds it. Expo is the one that ships, and the default.
	 */
	flavour?: MobileAppDeclaration['flavour'];
	/**
	 * The scheme's base, before a stage suffix.
	 *
	 * Normally omitted: it is the project's name — `shop` — and a local
	 * stage suffixes it. Give one only when the app is known by another name.
	 */
	scheme?: string;
}

export class MobileApp<TName extends string = string>
	implements Declarable<TName>
{
	readonly id: TName;
	/** The key its scheme arrives under — what its `app.config.ts` reads. */
	readonly keys: { scheme: string };

	constructor(
		id: ConstructName<TName>,
		private readonly config: MobileAppConfig,
		/** Internal: how `.dependsOn()` carries edges into the copy it returns. */
		private readonly dependencies: readonly Dependency[] = [],
	) {
		this.id = canonicalId(id as string) as TName;
		this.keys = { scheme: provideKey(this.id, 'scheme') };
	}

	/**
	 * What this app calls — the surfaces it is built with the URLs of, and the
	 * ones that come to trust its scheme.
	 *
	 * Immutable, like every other builder: it returns a new app rather than
	 * changing this one.
	 */
	dependsOn(constructs: readonly Declarable[]): MobileApp<TName> {
		return new MobileApp<TName>(this.id as ConstructName<TName>, this.config, [
			...this.dependencies,
			...constructs.map(edgeTo),
		]);
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'mobile-app',
				id: this.id,
				flavour: this.config.flavour ?? 'expo',
				app: { path: this.config.path },
				...(this.config.scheme ? { scheme: this.config.scheme } : {}),
				dependencies: this.dependencies,
				provides: [this.keys.scheme],
			},
		];
	}
}
