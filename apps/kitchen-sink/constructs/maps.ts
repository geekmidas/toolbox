import { Maps } from '@geekmidas/constructs/maps';

/**
 * Maps: the map itself, places and geocoding, called with API keys.
 *
 * Who holds which key is read off the graph, never written here. An endpoint
 * that depends on it holds `MAPS_API_KEY` (`services.maps.apiKey`); a site
 * holds `MAPS_BROWSER_KEY`, inlined as `VITE_MAPS_BROWSER_KEY` and restricted
 * to the stage's sites' hosts; a mobile app holds an Android and an iOS key,
 * restricted to its package and bundle id. Nothing depends on it yet, so no
 * stage is asked for a key:
 *
 * ```ts
 * export const web = new StaticSite('Web', { path: 'apps/web' })
 *   .dependsOn([api, auth, uploads, maps]);
 * ```
 *
 * Deployed, `deploy.maps.<stage> = { provider: 'google' }` makes the keys in
 * a Google Cloud project; locally they are set by hand.
 */
export const maps = new Maps('Maps', {
	apis: ['maps', 'places', 'geocoding'],
});
