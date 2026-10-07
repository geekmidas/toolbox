/**
 * A target package as a user would install one: a directory under the
 * workspace's `node_modules`, with a `package.json`, an exports map and a
 * plain ES module — no build step, nothing of this repository imported.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PluginPackage {
	/** The package name, scoped or not. */
	name: string;
	/** `gkm.runtime` in its package.json; `null` leaves the field out. */
	declares?: 'server' | 'aws' | 'lambda' | null;
	/** The module's source. Defaults to {@link pluginSource}. */
	source?: string;
}

/**
 * A target that records each phase it runs on `globalThis.__gkmPlugin`, takes
 * `{ region, fail }` options through a hand-written Standard Schema, and can
 * roll back. Importing it sets `globalThis.__gkmPluginLoaded`.
 */
export function pluginSource(runtime: 'server' | 'aws' = 'server'): string {
	return `
globalThis.__gkmPluginLoaded = true;
const calls = (globalThis.__gkmPlugin ??= []);

/** A Standard Schema, written out: what a Zod schema provides. */
const options = {
  '~standard': {
    version: 1,
    vendor: 'fixture',
    validate(value) {
      const input = value ?? {};
      if (input.region !== undefined && typeof input.region !== 'string') {
        return { issues: [{ message: 'must be a string', path: ['region'] }] };
      }
      return { value: { region: input.region ?? 'ams', fail: input.fail ?? null } };
    },
  },
};

export default {
  name: 'fixture',
  runtime: '${runtime}',
  capabilities: { rollback: true, migrations: 'target', images: false },
  credentials: [],
  options,
  async validate(ctx) {
    calls.push(['validate', ctx.options, ctx.apps, ctx.cwd, ctx.name('api')]);
    ctx.secrets.mask('hunter2-secret');
    ctx.logger.info('validating with hunter2-secret');
    return { released: [] };
  },
  async plan(ctx) {
    calls.push(['plan']);
    ctx.emit({ type: 'resource.planned', key: 'app:api', resourceType: 'app', action: 'create' });
  },
  async provision() { calls.push(['provision']); },
  async build(ctx) {
    calls.push(['build']);
    ctx.emit({ type: 'artifact.built', app: 'api', imageRef: 'fixture/api:' + ctx.tag });
  },
  async release(ctx, run) {
    calls.push(['release']);
    if (ctx.options.fail === 'release') throw new Error('release broke');
    run.released.push('api');
    ctx.emit({ type: 'app.deployed', app: 'api', applicationId: 'fx-1', imageRef: 'fixture/api', url: 'https://api.fixture' });
  },
  async verify(ctx) {
    calls.push(['verify']);
    const healthy = ctx.options.fail !== 'verify';
    ctx.emit({ type: 'health.checked', app: 'api', url: 'https://api.fixture/health', healthy, status: healthy ? 200 : 503, attempt: 1 });
    if (!healthy) throw new Error('api is not healthy');
  },
  async rollback(ctx, run, failure) {
    calls.push(['rollback', failure.phase, failure.error.message]);
  },
  result(ctx, run) {
    return {
      apps: run.released.map((appName) => ({ appName, type: 'backend', success: true })),
      projectId: '',
      environmentId: '',
      successCount: run.released.length,
      failedCount: 0,
      stage: ctx.stage,
      identity: ctx.identity.key,
      tag: ctx.tag,
      dryRun: ctx.dryRun,
      skipped: [...ctx.skipped],
      urls: {},
      changes: [],
    };
  },
};
`;
}

/** Write `plugin` into `root/node_modules`, as `pnpm add` would. */
export function installPlugin(root: string, plugin: PluginPackage): string {
	const dir = join(root, 'node_modules', ...plugin.name.split('/'));
	mkdirSync(join(dir, 'dist'), { recursive: true });
	const declares = plugin.declares === undefined ? 'server' : plugin.declares;
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({
			name: plugin.name,
			version: '1.0.0',
			type: 'module',
			// ESM only, behind an exports map: what `require.resolve` cannot
			// load and a plugin built today usually is.
			exports: { '.': { import: './dist/index.mjs' } },
			...(declares === null ? {} : { gkm: { runtime: declares } }),
		}),
	);
	writeFileSync(
		join(dir, 'dist', 'index.mjs'),
		plugin.source ?? pluginSource(),
	);
	return dir;
}
