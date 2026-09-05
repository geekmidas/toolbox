import { defineConfig } from 'vitest/config';

/**
 * The kitchen-sink suite.
 *
 * Deliberately outside the root config's `projects: ['packages/*']`: these are
 * not unit tests over a package, they are the application driven end to end
 * against the containers the local target reconciled — a real Postgres with the
 * real role split, a real MinIO with the declared bucket policy, a real Mailpit,
 * and whichever broker the project selected.
 *
 * That means they only run through `gkm test`, which is what reconciles the
 * `test` stage and injects the URLs the app reads. Running `vitest` here
 * directly gets an app with no addresses and fails at the first import, which is
 * the correct failure — there is nothing to test without the stage.
 *
 * Single-threaded and serial on purpose. The suite drives one application
 * instance holding one set of pollers; two workers would each boot their own,
 * both would drain the same queue, and which one got a given message would
 * decide whether a test passed.
 */
export default defineConfig({
	test: {
		name: 'kitchen-sink',
		include: ['src/__tests__/**/*.spec.ts'],
		globalSetup: ['./src/__tests__/__helpers__/globalSetup.ts'],
		// Vitest 4 flattened these out of `poolOptions`.
		pool: 'threads',
		maxWorkers: 1,
		minWorkers: 1,
		fileParallelism: false,
		// Containers, a broker poll interval, and mail delivery. The default 5s
		// fails on a cold Docker rather than on anything the app did — and the
		// *first* run against a fresh stage pays for pg-boss creating its own
		// schema before it will deliver anything, which is slower than every run
		// after it.
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
