/**
 * The hand-off between `gkm test` and the Vitest global setup.
 *
 * `gkm test` reconciles and migrates the test stage before Vitest starts; the
 * setup, run inside Vitest, only has to load what that left. Started by plain
 * `vitest` instead, the setup runs `gkm test --setup` itself first — so there is
 * one way the stage gets ready, whichever started the suite.
 */

/** Set on the Vitest process by `gkm test`: the stage is ready, here. */
export const TEST_READY_ENV = 'GKM_TEST_READY';

/** Where `gkm test` records what it prepared, from where it ran. */
export const TEST_READY_FILE = '.gkm/test-ready.json';

export interface TestReady {
	/** The resolved environment, as a JSON object of strings. */
	env: string;
	/** The test manifest the `#test` harness reads. */
	manifest?: string;
}
