import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { loadWorkspaceConfig } from '../../../config';
import { discover } from '../../../reconcile/discover';
import { constructGlobs } from '../../../reconcile/workspace';
import type { NormalizedWorkspace } from '../../../workspace/types';

const FIXTURE = join(import.meta.dirname, '..', '__fixtures__', 'compose-app');

export interface ComposeAppOptions {
	/** The workspace name — what the compose project and image names derive from. */
	name?: string;
	/** The deployed stage's base domain. */
	domain?: string;
	/** Where images are pushed and pulled. */
	registry?: string;
}

/**
 * A workspace written the way one is now: a RestApi authenticated by a
 * BetterAuth server in its own container, a database with the auth tenant's
 * migration committed, and a Vite site that calls both.
 *
 * The code is the fixture; what a project keeps beside it — package files,
 * the workspace config — is written here, so the fixture holds nothing that
 * resolves only once copied.
 */
export function writeComposeApp(
	dir: string,
	options: ComposeAppOptions = {},
): void {
	const name = options.name ?? 'compose-app';
	cpSync(FIXTURE, dir, { recursive: true });

	const json = (path: string, value: unknown) =>
		writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`);

	json('package.json', {
		name,
		private: true,
		type: 'module',
		packageManager: 'pnpm@10.13.1',
	});
	writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
	json('turbo.json', {
		$schema: 'https://turborepo.com/schema.json',
		tasks: { build: { outputs: ['dist/**'] } },
	});

	for (const app of ['api', 'auth']) {
		mkdirSync(join(dir, 'apps', app), { recursive: true });
		json(`apps/${app}/package.json`, {
			name: `@${name}/${app}`,
			private: true,
			type: 'module',
		});
	}
	json('apps/web/package.json', {
		name: `@${name}/web`,
		private: true,
		type: 'module',
		scripts: { build: 'vite build' },
		devDependencies: { vite: '~8.3.1' },
	});

	writeFileSync(
		join(dir, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: ${JSON.stringify(name)},
  stages: { local: 'development', deployed: ['production'] },
  constructs: ['./constructs/**/*.ts', './apps/*/endpoints/**/*.ts'],
  deploy: {
    default: 'dokploy',
    domains: { production: ${JSON.stringify(options.domain ?? 'shop.example.com')} },
    ${options.registry ? `dokploy: { endpoint: 'https://dokploy.example.com', registry: ${JSON.stringify(options.registry)} },` : ''}
  },
});
`,
	);
}

/** The workspace at `dir`, its manifest, and its runnables' edges. */
export async function loadComposeApp(dir: string): Promise<{
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	runnables: Record<string, string[]>;
}> {
	const { workspace } = await loadWorkspaceConfig(dir);
	const runnables: Record<string, string[]> = {};
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
		runnables,
	});
	return { workspace, manifest, runnables };
}
