import { mkdirSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineProject } from 'vitest/config';

/**
 * Where the suites' throwaway projects live — `createTempDir`, testkit's
 * `itWithDir`, every `mkdtemp(tmpdir())` — with this package's `node_modules`
 * beside them.
 *
 * Those projects import `@geekmidas/constructs` the way a real one does, and a
 * real one has a `node_modules` above it. Vitest 3's vite-node resolved such
 * bare imports from the project root regardless; Vitest 4 replaced it with
 * Vite's module runner, which leaves them to Node, and Node finds nothing
 * above the OS temp directory. Linking this package's `node_modules` in makes
 * them resolve for the reason they would anywhere else — and keeps them
 * outside the repository, whose lockfile and workspace config the init,
 * upgrade and workspace suites would otherwise find above every one of them.
 */
const scratch = mkdtempSync(join(tmpdir(), 'gkm-cli-tests-'));
const own = join(import.meta.dirname, 'node_modules');
const installed = join(scratch, 'node_modules');
mkdirSync(installed);

// This package's dependencies, one link each, plus `@geekmidas/cli` itself —
// which its own `node_modules` cannot hold, and which a scaffolded
// `gkm.config.ts` imports as `@geekmidas/cli/config`.
for (const entry of readdirSync(own)) {
	if (!entry.startsWith('@')) {
		symlinkSync(join(own, entry), join(installed, entry));
		continue;
	}
	mkdirSync(join(installed, entry), { recursive: true });
	for (const name of readdirSync(join(own, entry))) {
		symlinkSync(join(own, entry, name), join(installed, entry, name));
	}
}
mkdirSync(join(installed, '@geekmidas'), { recursive: true });
symlinkSync(import.meta.dirname, join(installed, '@geekmidas', 'cli'));

export default defineProject({
	test: {
		name: 'cli',
		// `os.tmpdir()` reads TMPDIR, so every way the suites make a temp
		// directory lands in `scratch` without any of them knowing. GKM_HOME
		// does the same for stage keys and stored logins: a suite that writes
		// one never writes it into the home of whoever runs the tests.
		//
		// Every `gkm dev` a suite starts joins discovery: on a port of its own
		// rather than the machine's 4983, which a developer's own `gkm dev` holds,
		// and registered in the scratch directory rather than `~/.gkm/dev`.
		env: {
			TMPDIR: scratch,
			GKM_HOME: join(scratch, 'gkm-home'),
			GKM_DISCOVERY_PORT: '0',
			GKM_DEV_REGISTRY: join(scratch, 'gkm-dev'),
			// A deploy refuses to keep a stage's state on a CI runner
			// (`LocalStateInCi`), and the suites deploy with local state on
			// purpose. They run as a laptop would; the suites that assert the
			// refusal set these themselves. Whether the run really is CI stays
			// readable as GKM_TEST_IN_CI.
			CI: 'false',
			GITHUB_ACTIONS: 'false',
			GKM_TEST_IN_CI: process.env.CI ?? '',
		},
		// The `deploy/` suites drive real AWS SDK clients against the local
		// emulator — SSM for deploy state, S3 and IAM for backup destinations.
		// They were the only failing suites in the repo, and they were failing
		// because nothing started the emulator rather than because anything was
		// wrong with them.
		//
		// `gkm dev` is run against a real app too: its auth server signs a user
		// up in the test Postgres, and its API queries through the database it
		// declared.
		globalSetup: [
			'../testkit/test/awsSetup.ts',
			'../testkit/test/globalSetup.ts',
		],
		// `*.test-d.ts` are compiled, and a type error in one is a failure: an
		// assertion about a type in a runtime spec compiles to nothing and
		// passes whatever the type is.
		typecheck: {
			enabled: true,
			include: ['src/**/*.test-d.ts'],
		},
	},
});
