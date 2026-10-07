/**
 * From a name to a target: the host's, then the built-ins, then
 * `deploy.targets`, with a fixture package installed in a real workspace and
 * loaded the way a user's would be.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { providerOf } from '../../workspace/backends';
import { DeployTargetNotYetSupported, UnknownDeployTarget } from '../builtins';
import { defineTarget } from '../define';
import { dokployTarget } from '../dokploy';
import { TargetPackageNotFound } from '../package';
import {
	InvalidTargetOptions,
	parseTargetOptions,
	resolveTarget,
	TargetEntryInvalid,
	TargetPackageInvalid,
	TargetRuntimeMismatch,
} from '../resolve';
import { runtimeOf, TargetRuntimeUndeclared } from '../runtime';
import type { DeployTargetEntry } from '../types';
import { installPlugin, pluginSource } from './__helpers__/plugin';

const PLUGIN = '@acme/gkm-target';

/** A target written in the test, for the host and inline entries. */
const inline = (name: string) =>
	defineTarget({
		name,
		runtime: 'aws',
		capabilities: { rollback: false, migrations: 'app', images: false },
		async validate() {},
		async plan() {},
		async release() {},
		result: () => {
			throw new Error('not deployed in these tests');
		},
	});

describe('resolveTarget', () => {
	let root: string;
	const globals = globalThis as {
		__gkmPluginLoaded?: boolean;
		__gkmPlugin?: unknown[];
	};

	const workspace = (targets: Record<string, DeployTargetEntry> = {}) => ({
		root,
		deploy: { targets },
	});

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-targets-')));
		delete globals.__gkmPluginLoaded;
		delete globals.__gkmPlugin;
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	describe('in order', () => {
		it("takes the host's target over a built-in of the same name", async () => {
			const mine = inline('my-dokploy');

			const resolved = await resolveTarget('dokploy', {
				workspace: workspace(),
				host: { dokploy: mine },
				stage: 'production',
			});

			expect(resolved).toMatchObject({ source: 'host', name: 'dokploy' });
			expect(resolved.target).toBe(mine);
		});

		it("takes the host's target over the config's", async () => {
			installPlugin(root, { name: PLUGIN });
			const mine = inline('mine');

			const resolved = await resolveTarget('acme', {
				workspace: workspace({ acme: PLUGIN }),
				host: { acme: mine },
				stage: 'production',
			});

			expect(resolved.target).toBe(mine);
			// The config's package was never even imported.
			expect(globals.__gkmPluginLoaded).toBeUndefined();
		});

		it('takes a built-in over a config entry that borrows its name', async () => {
			installPlugin(root, { name: PLUGIN });

			const resolved = await resolveTarget('dokploy', {
				workspace: workspace({ dokploy: PLUGIN }),
				stage: 'production',
			});

			expect(resolved).toMatchObject({ source: 'builtin' });
			expect(resolved.target).toBe(dokployTarget);
			expect(globals.__gkmPluginLoaded).toBeUndefined();
		});

		it('loads a package named in deploy.targets from the workspace root', async () => {
			installPlugin(root, { name: PLUGIN });

			const resolved = await resolveTarget('acme', {
				workspace: workspace({ acme: PLUGIN }),
				stage: 'production',
			});

			expect(resolved).toMatchObject({ source: 'config', name: 'acme' });
			expect(resolved.target.name).toBe('fixture');
			expect(await parseTargetOptions(resolved)).toEqual({
				region: 'ams',
				fail: null,
			});
		});

		it('finds the package from a workspace nested below where it is installed', async () => {
			installPlugin(root, { name: PLUGIN });
			const nested = join(root, 'projects', 'shop');
			mkdirSync(nested, { recursive: true });

			const resolved = await resolveTarget('acme', {
				workspace: { root: nested, deploy: { targets: { acme: PLUGIN } } },
				stage: 'production',
			});

			expect(resolved.target.name).toBe('fixture');
		});

		it('passes [package, options] through the target’s schema', async () => {
			installPlugin(root, { name: PLUGIN });

			const resolved = await resolveTarget('acme', {
				workspace: workspace({ acme: [PLUGIN, { region: 'fra' }] }),
				stage: 'production',
			});

			expect(resolved.options).toEqual({ region: 'fra' });
			expect(await parseTargetOptions(resolved)).toEqual({
				region: 'fra',
				fail: null,
			});
		});

		it('takes a target object, alone or with options', async () => {
			const target = inline('local');

			const alone = await resolveTarget('local', {
				workspace: workspace({ local: target }),
				stage: 'production',
			});
			const paired = await resolveTarget('local', {
				workspace: workspace({ local: [target, undefined] }),
				stage: 'production',
			});

			expect(alone.target).toBe(target);
			expect(paired.target).toBe(target);
		});

		it('does not guess a package from the name', async () => {
			// Installed, under the very name a convention would guess — and
			// still not used, because nothing named it.
			installPlugin(root, { name: '@acme/target' });

			const error = await resolveTarget('acme', {
				workspace: workspace(),
				stage: 'production',
			}).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(UnknownDeployTarget);
			expect(globals.__gkmPluginLoaded).toBeUndefined();
		});
	});

	describe('refusing', () => {
		it('names what would have resolved, for a name nothing has', async () => {
			const error = await resolveTarget('kubernetes', {
				workspace: workspace({ acme: PLUGIN }),
				stage: 'production',
			}).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(UnknownDeployTarget);
			expect(error).toMatchObject({
				target: 'kubernetes',
				known: ['dokploy', 'compose', 'sst', 'acme'],
			});
			expect((error as Error).message).toContain('deploy: { targets:');
		});

		it('says how to deploy SST instead', async () => {
			const error = await resolveTarget('sst', {
				workspace: workspace(),
				stage: 'staging',
			}).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(DeployTargetNotYetSupported);
			expect((error as Error).message).toContain(
				'gkm build && sst deploy --stage staging',
			);
		});

		it.each([
			'vercel',
			'cloudflare',
		])('refuses %s as not yet supported', async (name) => {
			await expect(
				resolveTarget(name, { workspace: workspace(), stage: 'production' }),
			).rejects.toBeInstanceOf(DeployTargetNotYetSupported);
		});

		it('names the package that is not installed, and how to add it', async () => {
			const error = await resolveTarget('acme', {
				workspace: workspace({ acme: '@acme/missing' }),
				stage: 'production',
			}).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(TargetPackageNotFound);
			expect((error as Error).message).toContain('pnpm add -D @acme/missing');
		});

		it('refuses a package that does not declare its runtime, without running it', async () => {
			installPlugin(root, { name: PLUGIN, declares: null });

			const error = await resolveTarget('acme', {
				workspace: workspace({ acme: PLUGIN }),
				stage: 'production',
			}).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(TargetRuntimeUndeclared);
			expect((error as Error).message).toContain('"gkm": { "runtime"');
			expect(globals.__gkmPluginLoaded).toBeUndefined();
		});

		it('refuses a runtime the package declares and the target contradicts', async () => {
			installPlugin(root, { name: PLUGIN, declares: 'aws' });

			const error = await resolveTarget('acme', {
				workspace: workspace({ acme: PLUGIN }),
				stage: 'production',
			}).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(TargetRuntimeMismatch);
			expect(error).toMatchObject({ declared: 'aws', actual: 'server' });
		});

		it('refuses a package whose default export is not a target', async () => {
			installPlugin(root, {
				name: PLUGIN,
				source: 'export default { name: "half" };',
			});

			await expect(
				resolveTarget('acme', {
					workspace: workspace({ acme: PLUGIN }),
					stage: 'production',
				}),
			).rejects.toBeInstanceOf(TargetPackageInvalid);
		});

		it('refuses an entry that is no target at all', async () => {
			await expect(
				resolveTarget('acme', {
					workspace: workspace({ acme: { name: 'acme' } as never }),
					stage: 'production',
				}),
			).rejects.toBeInstanceOf(TargetEntryInvalid);
		});

		it('refuses options the schema rejects, naming the field', async () => {
			installPlugin(root, { name: PLUGIN });
			const resolved = await resolveTarget('acme', {
				workspace: workspace({ acme: [PLUGIN, { region: 42 }] }),
				stage: 'production',
			});

			const error = await parseTargetOptions(resolved).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(InvalidTargetOptions);
			expect((error as Error).message).toContain('region: must be a string');
		});

		it('refuses options for a target that takes none', async () => {
			const target = inline('local');
			const resolved = await resolveTarget('local', {
				workspace: workspace({ local: [target, { region: 'ams' }] }),
				stage: 'production',
			});

			await expect(parseTargetOptions(resolved)).rejects.toBeInstanceOf(
				InvalidTargetOptions,
			);
		});
	});
});

describe('runtime, without loading the target', () => {
	let root: string;
	const globals = globalThis as { __gkmPluginLoaded?: boolean };

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-runtime-')));
		delete globals.__gkmPluginLoaded;
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("reads a package's runtime from its package.json", () => {
		installPlugin(root, {
			name: PLUGIN,
			declares: 'aws',
			source: pluginSource('aws'),
		});

		expect(
			providerOf({
				root,
				deploy: { default: 'acme', targets: { acme: PLUGIN } },
			}),
		).toBe('aws');
		// `gkm dev` asked, and the plugin never ran.
		expect(globals.__gkmPluginLoaded).toBeUndefined();
	});

	it('reads the built-ins and inline targets from what they declare', () => {
		expect(runtimeOf('dokploy', {})).toBe('server');
		expect(runtimeOf('sst', {})).toBe('aws');
		expect(
			runtimeOf('local', { deploy: { targets: { local: inline('local') } } }),
		).toBe('aws');
		expect(
			runtimeOf('paired', {
				deploy: { targets: { paired: [inline('paired'), {}] } },
			}),
		).toBe('aws');
	});

	it('refuses a runtime that is not one', () => {
		installPlugin(root, { name: PLUGIN, declares: 'lambda' });

		expect(() =>
			providerOf({
				root,
				deploy: { default: 'acme', targets: { acme: PLUGIN } },
			}),
		).toThrow(TargetRuntimeUndeclared);
	});

	it('refuses a name nothing has', () => {
		expect(() => providerOf({ deploy: { default: 'acme' } })).toThrow(
			UnknownDeployTarget,
		);
	});
});
