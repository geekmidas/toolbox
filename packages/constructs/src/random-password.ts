/**
 * `RandomPassword` — a password the platform generates, once per stage.
 *
 * ```ts
 * export const adminPassword = new RandomPassword('AdminPassword');
 *
 * // an endpoint that `.dependsOn([adminPassword])`
 * services.adminPassword // 'k3J…' — a string, no await
 * ```
 *
 * The app's own `secret`: the kind an auth server's signing key already is,
 * with nothing else attached. Nobody issues it and nobody sets it, which is
 * the line between it and a `Credential`:
 *
 * - **A deployed stage** generates it on the first deploy that needs it and
 *   keeps it — a server stage in its secrets store, an AWS stage in its
 *   state — so every later deploy reads the same value back. One set by hand
 *   (`gkm secrets:set`, `sst secret set`) is kept, never replaced.
 * - **`gkm dev` and `gkm test`** derive it from the project, the stage and the
 *   id, so nothing has to be set and it is the same on every run.
 *
 * Its key is its name, as a secret's is: `AdminPassword` is `ADMIN_PASSWORD`.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	environmentCase,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Construct } from './construct-interface';

export class RandomPassword<TName extends string = string>
	implements Construct<TName, string>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, string>;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the key the
	 * target publishes and the key the client reads cannot drift.
	 */
	private readonly key: string;

	constructor(id: ConstructName<TName>) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.key = environmentCase(canonical);

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.connect(options),
		};
	}

	declare(): Declaration[] {
		return [{ kind: 'secret', id: this.id, provides: [this.key] }];
	}

	private connect(options: ServiceRegisterOptions): string {
		return options.envParser
			.create((get) => ({ password: get(this.key).string() }))
			.parse().password;
	}
}
