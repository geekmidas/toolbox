/**
 * Name derivation — the single source for turning a construct's id into the
 * names that appear elsewhere.
 *
 * These live here rather than in each consumer because `@geekmidas/constructs`
 * derives a key when it declares, and `@geekmidas/cloud` derives the same key
 * when it supplies the value. Two implementations of the same rule is precisely
 * the drift this design exists to remove.
 */

import snakecase from 'lodash.snakecase';
import type { DeclarationKind } from './declaration';

import { InvalidConstructId } from './errors';

/**
 * `UPPER_SNAKE_CASE`, with numbers kept against the word they follow.
 *
 * Matches `environmentCase` in `@geekmidas/envkit`, which reads the values these
 * names key. The two must agree exactly, so this is the implementation and that
 * one should defer to it.
 *
 * @example environmentCase('sendEmail') // 'SEND_EMAIL'
 * @example environmentCase('api2')      // 'API2'  (digit joins its word)
 */
export function environmentCase(name: string): string {
	return snakecase(name)
		.toUpperCase()
		.replace(/_\d+/g, (r) => r.replace('_', ''));
}

/**
 * The env key a construct provides for one of its roles.
 *
 * @example provideKey('Uploads', 'url')      // 'UPLOADS_URL'
 * @example provideKey('Uploads', 'cdnUrl')   // 'UPLOADS_CDN_URL'
 */
export function provideKey(id: string, role: string): string {
	return environmentCase(`${id}_${role}`);
}

/**
 * A construct's canonical id — PascalCase.
 *
 * `uploads`, `Uploads`, `user_uploads`, and `user-uploads` all canonicalise to
 * the same id, so declaring two of them is a duplicate rather than a collision
 * to detect.
 *
 * Runtime only. Writing the id in PascalCase is what keeps the *type* usable:
 * the service key is `Uncapitalize<TName>`, a TypeScript intrinsic, so no
 * type-level transform is needed and none has to be kept in step with this one.
 *
 * @example canonicalId('user-uploads') // 'UserUploads'
 */
export function canonicalId(input: string): string {
	// `upperFirst(camelCase(x))` by another route — snakecase is already a
	// dependency, and adding lodash.camelcase for the same result is not worth it.
	const id = snakecase(input)
		.split('_')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');

	if (!VALID_ID.test(id)) throw new InvalidConstructId(input, id);
	return id;
}

/**
 * A canonical id: PascalCase, letters and digits only.
 *
 * Narrower than a JavaScript identifier — `_id` and `$ref` are legal JavaScript
 * and rejected here — because the id also has to survive `environmentCase` into
 * an env key and `cloudName` into a DNS-safe resource name.
 */
const VALID_ID = /^[A-Z][A-Za-z0-9]*$/;

/**
 * The key a construct is reached under in the service record.
 *
 * The runtime twin of `Uncapitalize<TName>`, which types it — they must agree,
 * so they live next to each other rather than being re-derived by each
 * construct.
 *
 * @example serviceKey('UserUploads') // 'userUploads' → services.userUploads
 */
export function serviceKey(id: string): string {
	return id.charAt(0).toLowerCase() + id.slice(1);
}

/**
 * The table a cache keeps its entries in, when nobody named one.
 *
 * Derived from the cache's own id rather than fixed at `cache`, because a
 * database may hold more than one and two caches sharing a table share a
 * keyspace — `orders.cache('Sessions')` and `orders.cache('Rates')` would
 * silently read each other's entries and evict each other's keys.
 *
 * Prefixed rather than suffixed so every cache sorts together in `\dt`, and
 * prefixed at all so a cache named for a thing the application also stores —
 * `orders.cache('Users')` — cannot collide with the table holding that thing.
 *
 * Read by whoever composes the URL and by whoever creates the table, so both
 * default the same way.
 *
 * @example cacheTable('Sessions') // 'cache_sessions'
 */
export function cacheTable(id: string): string {
	return `cache_${id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;
}

/**
 * The physical name a target provisions a construct under — lowercase kebab,
 * scoped so two stages or apps sharing an account cannot collide.
 *
 * @example cloudName({ stage: 'prod', app: 'myapp' }, 'UserUploads')
 * //        'prod-myapp-user-uploads'
 */
export function cloudName(
	scope: { stage: string; app: string },
	id: string,
): string {
	return [scope.stage, scope.app, snakecase(id).replace(/_/g, '-')]
		.join('-')
		.toLowerCase();
}

/**
 * The domain a cookie must be scoped to so a surface and its callers share it.
 *
 * Derived from the addresses rather than configured, for the same reason the
 * origins are: the set of things that talk to a surface is already in the graph,
 * and the domain they have in common is a fact about that set. Returned with the
 * leading dot a `Domain` attribute wants.
 *
 * Returns `undefined` when there is nothing to scope, which is the common case
 * and not a failure:
 *
 * - **One host.** Locally everything is `localhost` on different ports, and
 *   cookies ignore the port — so a `Domain` would add nothing and `.localhost`
 *   is not a domain a browser will accept.
 * - **Nothing in common.** Unrelated hosts cannot share a cookie at all, and
 *   emitting the longest common suffix anyway would be a value that silently
 *   fails to set.
 *
 * **The public-suffix limit, stated rather than discovered.** Two apps on
 * `a.vercel.app` and `b.vercel.app` share `.vercel.app`, which every browser
 * rejects because it is a registrable suffix rather than a registrable domain.
 * Resolving that correctly needs the Public Suffix List, which is a downloaded,
 * expiring dataset — so this requires at least two labels and otherwise trusts
 * the addresses, and the value stays overridable for the case it gets wrong.
 */
export function cookieDomain(urls: readonly string[]): string | undefined {
	const hosts = new Set<string>();

	for (const url of urls) {
		try {
			const { hostname } = new URL(url);
			// An IP address has no parent to share: `.0.0.1` is not a domain.
			if (/^\d+(\.\d+){3}$/.test(hostname) || hostname.includes(':')) return;
			hosts.add(hostname.toLowerCase());
		} catch {
			// Not an address. Nothing to derive from, and guessing is worse than
			// leaving the attribute off.
			return;
		}
	}

	if (hosts.size === 0) return;
	// One host already shares its cookies with itself, whatever the port.
	if (hosts.size === 1) return;

	const [first = [], ...rest] = [...hosts].map((host) =>
		host.split('.').reverse(),
	);
	const shared: string[] = [];

	for (const [index, label] of first.entries()) {
		if (!rest.every((labels) => labels[index] === label)) break;
		shared.push(label);
	}

	// One shared label is a TLD — `.com` is not a cookie domain.
	if (shared.length < 2) return;

	return `.${shared.reverse().join('.')}`;
}

/**
 * The env key a construct's provided role actually becomes.
 *
 * Almost always `provideKey(id, role)` — and `secret` is the exception, because
 * a secret's *name* is its key: `Auth` signs with `AUTH_SECRET`, which is also
 * what better-auth's own tooling looks for, and qualifying it by role would
 * produce `AUTH_SECRET_VALUE`.
 *
 * It lives here rather than in each target because two targets deriving the
 * same key separately is exactly the drift the app/infra contract check exists
 * to catch — and a check deriving the key differently from the thing it checks
 * cannot catch anything.
 */
export function providedKeyFor(
	id: string,
	kind: DeclarationKind,
	role: string,
): string {
	return kind === 'secret' ? environmentCase(id) : provideKey(id, role);
}
