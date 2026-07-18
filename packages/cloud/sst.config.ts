/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Minimal SST app whose only purpose is to let `sst install` generate the
 * `.sst/platform/` ambient globals (`sst`, `aws`, `$util`, …) that the
 * source-only `./sst` constructs extend. This is NOT a deployable app — it
 * exists so `src/sst` can be type-checked locally and in CI. See
 * `docs/sst-constructs.md` §2 and §12.
 */
export default $config({
	app() {
		return {
			name: 'geekmidas-cloud',
			home: 'aws',
		};
	},
	async run() {},
});
