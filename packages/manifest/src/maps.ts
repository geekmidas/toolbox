/**
 * Which of a `Maps` construct's keys a caller is handed, and where its own
 * is kept.
 *
 * One rule, read by every place that hands out a key — the env a process is
 * given, the values a bundle inlines, the keys a provider creates — so a site
 * can never be built with the key a phone holds, nor a server's land in a
 * bundle.
 *
 * **A key per caller, under one name.** Every caller reads its key by the
 * construct's name for its role — `MAPS_API_KEY`, `MAPS_BROWSER_KEY`,
 * `MAPS_ANDROID_KEY`, `MAPS_IOS_KEY` — and on a deployed stage each holds a
 * key of its own, kept in the stage's secrets as `<name>__<CALLER>`
 * (`MAPS_BROWSER_KEY__WEB`, `MAPS_BROWSER_KEY__ADMIN`): restricted to that
 * caller alone, rotated alone, and counted alone in Cloud Console.
 */

import type {
	ConstructManifest,
	DeclarationKind,
	Provides,
} from './declaration';
import { environmentCase, providedKeyFor } from './naming';

/** A `Maps` key's role: whose it is. */
export type MapsRole = keyof Provides<'maps'>;

/** Every role, in the order a provider creates them. */
export const MAPS_ROLES: readonly MapsRole[] = [
	'apiKey',
	'browserKey',
	'androidKey',
	'iosKey',
];

/**
 * The roles a caller of `kind` holds: a site the browser key, a mobile app
 * one per platform, anything else — a process on a server — the server key.
 */
export function mapsRolesFor(kind: DeclarationKind): readonly MapsRole[] {
	if (kind === 'site') return ['browserKey'];
	if (kind === 'mobile-app') return ['androidKey', 'iosKey'];
	return ['apiKey'];
}

/** Between a role's name and the caller a stored key is its: `__`. */
const CALLER_SEPARATOR = '__';

/**
 * Where the stage's secrets keep the key `caller` holds of the `Maps`
 * construct `maps` in `role` — `MAPS_BROWSER_KEY__WEB` for the site `Web`.
 *
 * `environmentCase` never writes two underscores in a row, so no construct's
 * own key can be read as a caller's.
 */
export function mapsKeyOf(
	maps: string,
	role: MapsRole,
	caller: string,
): string {
	return `${providedKeyFor(maps, 'maps', role)}${CALLER_SEPARATOR}${environmentCase(caller)}`;
}

/** The role `key` names of the `Maps` construct `maps`, as its callers read it. */
export function mapsRoleOf(maps: string, key: string): MapsRole | undefined {
	return MAPS_ROLES.find((role) => providedKeyFor(maps, 'maps', role) === key);
}

/**
 * Whether `key` is where a caller's own key of one of the manifest's `Maps`
 * constructs is kept — a value only that caller is handed, under the role's
 * name, and never a stage key every process reads.
 */
export function isMapsCallerKey(
	manifest: ConstructManifest,
	key: string,
): boolean {
	if (!key.includes(CALLER_SEPARATOR)) return false;
	return Object.values(manifest).some(
		(declaration) =>
			declaration.kind === 'maps' &&
			MAPS_ROLES.some((role) =>
				key.startsWith(
					`${providedKeyFor(declaration.id, 'maps', role)}${CALLER_SEPARATOR}`,
				),
			),
	);
}
