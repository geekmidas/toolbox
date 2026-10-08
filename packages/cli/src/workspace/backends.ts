/**
 * Which backend each declared kind resolves to — decided by where the project
 * deploys, and by nothing else.
 *
 * These used to be read out of a `services:` block, where one key answered two
 * questions: *does this exist* and *what backs it*. The first is the manifest's
 * — a declared `Cache` is why there is a cache — and the second is the deploy
 * target's, because the right cache for a Lambda is not the right cache for a
 * box already running Postgres. With both answered elsewhere there was nothing
 * left for the block to say, so it is gone and these read the target.
 *
 * Mail has no answer here at all: every provider speaks SMTP, so the provider
 * is whichever one the stage's mail URL points at.
 */

import { runtimeOf, type TargetSource } from '../target/runtime.js';
import {
	DEFAULT_CACHE,
	DEFAULT_EVENTS,
	DEFAULT_STORAGE,
	type EventsBackend,
	type MainProvider,
	type StorageBackend,
	type TargetCacheBackend,
} from '../types.js';

/**
 * Which family of defaults a workspace's deploy target belongs to.
 *
 * One question, asked once: **does this target run containers the project
 * controls?** Dokploy does, so a bucket or a cache can live beside the app;
 * AWS, Vercel and Cloudflare do not, so the default has to be something
 * managed. That is the whole of the distinction, and it is why `MainProvider`
 * is the right axis rather than the deploy target's own name — targets share
 * answers.
 *
 * Each target declares its answer as its `runtime` — a target package in its
 * `package.json`, so this never loads one. A workspace that names no target
 * is on AWS: an SST project predates `deploy.default: 'sst'`.
 */
export function providerOf(workspace: TargetSource): MainProvider {
	const target = workspace.deploy?.default;
	return target ? runtimeOf(target, workspace) : 'aws';
}

/**
 * The cache backend a target implies.
 *
 * The same answer locally and deployed: a local `gkm dev` for an AWS app still
 * uses the Upstash protocol, because a backend that differed between the two
 * would be worse than a slower one.
 */
export function cacheBackendFor(on: MainProvider): TargetCacheBackend {
	return DEFAULT_CACHE[on];
}

/** Where a declared bucket lives on a target. */
export function storageBackendFor(on: MainProvider): StorageBackend {
	return DEFAULT_STORAGE[on];
}

/**
 * Which broker carries declared queues and topics on a target.
 *
 * Only consulted when something declares one; a project with no `Topic` or
 * `Queue` has no events at all, whatever the target.
 */
export function eventsBackendFor(on: MainProvider): EventsBackend {
	return DEFAULT_EVENTS[on];
}
