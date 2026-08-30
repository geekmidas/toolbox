/**
 * What a deploy configuration needs from reconcile.
 *
 * Narrow on purpose. An `sst.config.ts` needs to build the manifest — the same
 * manifest `gkm dev` builds, from the same glob — and needs nothing else in
 * here: the plan, the containers and the URL composition are the *local*
 * target's business, and a deploy target that reached for them would be
 * reimplementing them badly.
 *
 * One discovery, two targets, is the claim the whole design rests on. This is
 * the seam that makes it true rather than aspirational.
 */

export { type DiscoverOptions, discover, isDeclarable } from './discover.js';
export {
	MANIFEST_PATH,
	manifestModule,
	writeManifestModule,
} from './emit.js';
