import { describe } from 'vitest';

/**
 * Conformance for `memoryAdapter`, and it is currently not run.
 *
 * This suite had no assertions of its own: it handed the adapter to
 * `runAdapterTest`, better-auth's published conformance harness, and let
 * upstream decide what an adapter must do. better-auth 1.7 removed that
 * harness — not renamed, removed; `runAdapterTest` appears nowhere in the
 * package, and `better-auth/adapters/test` is no longer exported.
 *
 * So there is nothing here to repair. The options are to hold better-auth below
 * 1.7 to keep borrowing their suite, or to write our own assertions for what
 * `memoryAdapter` must do — which is the better answer anyway, since a
 * conformance test that only runs against a version we no longer support tells
 * us nothing.
 *
 * Skipped rather than deleted so the gap is visible: `memoryAdapter` currently
 * has no test at all, and a deleted file would not say so.
 */
describe.skip('Memory Adapter Tests', () => {});
