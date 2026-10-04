/**
 * The `--import` that installs `owning-tsconfig-jsx.mjs` — it must come before
 * tsx's own `--import`, so that tsx reads the source through it.
 *
 * Registered with `module.register()` whatever tsx chose: tsx's in-thread hooks
 * (`registerHooks`, Node 22.22.3+ / 24.11.1+) hand off to the off-thread chain
 * when they load a file, and on older Node tsx registers off-thread too, after
 * this — so either way this hook is asked after tsx, for the file's source.
 */

import { register } from 'node:module';
import { isInternalThread } from 'node:worker_threads';

// As tsx guards its own: where Node runs preloads in the hooks thread too,
// registering from there would hook the hooks.
if (!isInternalThread) {
	register('./owning-tsconfig-jsx.mjs', import.meta.url);
}
