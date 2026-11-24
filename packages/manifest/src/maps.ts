/**
 * Which of a `Maps` construct's keys a caller is handed.
 *
 * One rule, read by every place that hands out a key — the env a process is
 * given, the values a bundle inlines, the keys a provider creates — so a site
 * can never be built with the key a phone holds, nor a server's land in a
 * bundle.
 */

import type { DeclarationKind, Provides } from './declaration';
import { providedKeyFor } from './naming';

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

/** The keys a caller of `kind` is handed of the `Maps` construct `id`. */
export function mapsKeysFor(id: string, kind: DeclarationKind): string[] {
	return mapsRolesFor(kind).map((role) => providedKeyFor(id, 'maps', role));
}
