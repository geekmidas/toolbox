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
		// directory lands in `scratch` without any of them knowing.
		env: { TMPDIR: scratch },
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
	},
});
