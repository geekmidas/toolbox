import { Maps } from '@geekmidas/constructs/maps';

/**
 * Maps: the map itself, places and geocoding, called with API keys.
 *
 * Who holds which key is read off the graph, never written here. The API's
 * `POST /places/geocode` depends on it, so its process holds `MAPS_API_KEY`,
 * and its handler a client with `geocode`, `searchPlaces` and `placeDetails`
 * (`apps/api/endpoints/places.ts`). A site would hold `MAPS_BROWSER_KEY`,
 * inlined as `VITE_MAPS_BROWSER_KEY` and restricted to its host; a mobile app
 * an Android and an iOS key, restricted to its package and bundle id.
 *
 * Under `gkm test` no key is needed: Google's hosts are answered in-process
 * by the built-in fake. Locally the key is set by hand.
 *
 * Deployed, `deploy.maps.<stage> = { provider: 'google' }` makes the keys in
 * a Google Cloud project; locally they are set by hand.
 */
export const maps = new Maps('Maps', {
	apis: ['maps', 'places', 'geocoding'],
});
