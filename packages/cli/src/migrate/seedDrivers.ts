/**
 * The drivers a seed run registers before any seed runs.
 *
 * The seed runner is an entry point gkm owns, like the generated server and
 * the test harness, so it registers what they register — from the same
 * {@link driversFor}, so the two cannot drift. A seed then reaches a bucket or
 * a cache through the construct's service, exactly as a handler does, and no
 * application code names a provider.
 *
 * The registrations are written to a module under `.gkm/` and imported from
 * there, rather than imported by gkm itself: a registry is a module-level map,
 * so it has to be the copy the app's constructs resolve — which is the one a
 * bare specifier finds from the project root, not the one beside gkm.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConstructManifest } from '@geekmidas/manifest';
import { GkmError } from '../errors';
import {
	cacheBackendsIn,
	driversFor,
	eventsBackendsIn,
} from '../generators/drivers';
import type { CacheBackend, EventsBackend } from '../types';

/** Which backends the stage being seeded resolves its declarations to. */
export interface SeedBackends {
	cache: CacheBackend;
	events: EventsBackend;
}

/** The drivers a seed run needs could not be loaded from the project. */
export class SeedDriversUnresolved extends GkmError {
	constructor(
		readonly root: string,
		override readonly cause: unknown,
	) {
		super(
			`Could not load the drivers seeds run with from ${root} — ` +
				`${cause instanceof Error ? cause.message : String(cause)}. ` +
				`They are the ones the app's own entry registers; install the ` +
				`package it names where the project's constructs are declared.`,
		);
		this.name = 'SeedDriversUnresolved';
	}
}

/**
 * Register the drivers a generated entry for this project would: storage when
 * it installs `@geekmidas/storage`, the cache backend its caches resolve to,
 * and the broker its topics and queues do. Nothing when it declares none.
 */
export async function registerSeedDrivers(options: {
	root: string;
	manifest: ConstructManifest;
	backends: SeedBackends;
}): Promise<void> {
	const drivers = driversFor({
		appRoot: options.root,
		cache: cacheBackendsIn(options.manifest, options.backends.cache),
		events: eventsBackendsIn(options.manifest, options.backends.events),
	});
	if (!drivers.setup) return;

	const content = `${drivers.imports}\n\n${drivers.setup}\n`;
	const dir = join(options.root, '.gkm');
	const file = join(dir, 'seed-drivers.mjs');
	await mkdir(dir, { recursive: true });
	await writeFile(file, content);

	// Keyed by content: registration is idempotent, but a process seeding
	// twice after the declarations changed must load the new set.
	const url = pathToFileURL(file);
	url.searchParams.set(
		'v',
		createHash('sha256').update(content).digest('hex').slice(0, 12),
	);

	try {
		await import(url.href);
	} catch (error) {
		throw new SeedDriversUnresolved(options.root, error);
	}
}
