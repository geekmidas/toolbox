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
 *
 * 43 letters, digits, `-` and `_` unless told otherwise — for a system with
 * rules of its own:
 *
 * ```ts
 * new RandomPassword('RouterPassword', { length: 24, symbols: '!@#$%' });
 * ```
 *
 * The format is read when the password is generated, so changing it later
 * leaves a deployed stage's existing password as it is.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	environmentCase,
	type SecretFormat,
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

	constructor(
		id: ConstructName<TName>,
		private readonly format: RandomPasswordOptions = {},
	) {
		const canonical = canonicalId(id as string);
		const { length } = format;

		if (length !== undefined && !(Number.isInteger(length) && length > 0)) {
			throw new InvalidPasswordLength(canonical, length);
		}

		this.id = canonical as TName;
		this.key = environmentCase(canonical);

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.connect(options),
		};
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'secret',
				id: this.id,
				provides: [this.key],
				...(this.format.length !== undefined
					? { length: this.format.length }
					: {}),
				...(this.format.symbols !== undefined
					? { symbols: this.format.symbols }
					: {}),
			},
		];
	}

	private connect(options: ServiceRegisterOptions): string {
		return options.envParser
			.create((get) => ({ password: get(this.key).string() }))
			.parse().password;
	}
}

/**
 * What a password is drawn as. Letters and digits always; `symbols` beside
 * them, one of which is always present.
 */
export type RandomPasswordOptions = SecretFormat;

/** A `RandomPassword` given a length no password can have. */
export class InvalidPasswordLength extends Error {
	constructor(
		readonly id: string,
		readonly length: number,
	) {
		super(
			`${id} asks for a password ${length} characters long. ` +
				'Give it a whole number of characters, at least 1 — or leave length out for 43.',
		);
		this.name = 'InvalidPasswordLength';
	}
}
