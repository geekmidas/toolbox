/**
 * `deploy()` through a target the CLI does not ship: a package installed in
 * the workspace and named in its gkm.config.ts, run phase by phase.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CredentialProvider } from '../../deploy/credentials';
import { type DeployInput, deploy } from '../../deploy/deploy';
import type { DeployEvent } from '../../deploy/events';
import { RollbackFailed } from '../../deploy/orchestrate';
import { defineTarget } from '../define';
import { installPlugin } from './__helpers__/plugin';

const STAGE = 'production';
const PLUGIN = '@acme/gkm-target';

/** Nothing here needs a credential; asking for one is a failure. */
const credentials: CredentialProvider = {
	async get() {
		return undefined;
	},
};

/** A workspace that deploys through `acme`, with `options` if given. */
function writeWorkspace(root: string, entry: string): void {
	writeFileSync(
		join(root, 'package.json'),
		JSON.stringify({ name: 'shop', private: true, type: 'module' }),
	);
	writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
	for (const app of ['api', 'web']) {
		mkdirSync(join(root, 'apps', app), { recursive: true });
		writeFileSync(
			join(root, 'apps', app, 'package.json'),
			JSON.stringify({ name: `@shop/${app}`, type: 'module' }),
		);
	}
	writeFileSync(
		join(root, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['${STAGE}'] },
  apps: {
    api: { type: 'backend', path: 'apps/api', port: 3000 },
    web: { type: 'web', path: 'apps/web', port: 3001, framework: 'nextjs', deploy: 'sst' },
  },
  deploy: {
    default: 'acme',
    targets: { acme: ${entry} },
  },
});
`,
	);
}

/** The run's events, compactly: what a UI would draw. */
function sequence(events: DeployEvent[]): string[] {
	return events
		.filter((e) => e.type !== 'log')
		.map((e) => {
			switch (e.type) {
				case 'phase.started':
				case 'phase.finished':
				case 'phase.failed':
					return `${e.type} ${e.phase}`;
				case 'app.skipped':
				case 'app.deployed':
				case 'artifact.built':
				case 'health.checked':
					return `${e.type} ${e.app}`;
				default:
					return e.type;
			}
		});
}

describe('deploy() through a target package', () => {
	let root: string;
	const globals = globalThis as { __gkmPlugin?: unknown[][] };

	const run = async (input: Partial<DeployInput> = {}) => {
		const started = deploy({
			cwd: root,
			stage: STAGE,
			tag: 'v1',
			credentials,
			...input,
		});
		const events: DeployEvent[] = [];
		for await (const event of started) events.push(event);
		return {
			events,
			result: await started.result.catch((error: unknown) => error),
		};
	};

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-plugin-deploy-')));
		globals.__gkmPlugin = [];
		installPlugin(root, { name: PLUGIN });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('runs every phase in order, with the options from the config', async () => {
		writeWorkspace(root, `['${PLUGIN}', { region: 'fra' }]`);

		const { events, result } = await run();

		expect(result).toMatchObject({
			stage: STAGE,
			identity: 'shop/shop',
			tag: 'v1',
			successCount: 1,
			skipped: [{ app: 'web' }],
		});
		expect(sequence(events)).toEqual([
			'phase.started validate',
			'app.skipped web',
			'deploy.started',
			'phase.finished validate',
			'phase.started provision',
			'phase.finished provision',
			'phase.started build',
			'artifact.built api',
			'phase.finished build',
			'phase.started release',
			'app.deployed api',
			'phase.finished release',
			'phase.started verify',
			'health.checked api',
			'phase.finished verify',
			'deploy.finished',
		]);
		expect(events.find((e) => e.type === 'deploy.started')).toMatchObject({
			target: 'acme',
			apps: ['api'],
		});
		const [validate] = globals.__gkmPlugin!;
		expect(validate).toEqual([
			'validate',
			{ region: 'fra', fail: null },
			['api'],
			root,
			'production-shop-api',
		]);
		// The SST app was left to its own run, with the command for it.
		expect(events.find((e) => e.type === 'app.skipped')).toMatchObject({
			reason: expect.stringContaining(
				'gkm deploy --target sst --stage production',
			),
		});
	});

	it('masks a secret in every line it reports', async () => {
		writeWorkspace(root, `'${PLUGIN}'`);

		const { events } = await run();

		const lines = events.flatMap((e) => (e.type === 'log' ? [e.message] : []));
		expect(lines).toContain('validating with ***');
		expect(JSON.stringify(events)).not.toContain('hunter2-secret');
	});

	it('holds the stage for the run, and frees it after', async () => {
		writeWorkspace(root, `'${PLUGIN}'`);

		await run();

		expect(existsSync(join(root, '.gkm', `deploy-${STAGE}.lock`))).toBe(false);
	});

	it('plans a dry run, and runs nothing else', async () => {
		writeWorkspace(root, `'${PLUGIN}'`);

		const { events, result } = await run({ dryRun: true });

		expect(result).toMatchObject({ dryRun: true });
		expect(sequence(events)).toEqual([
			'phase.started validate',
			'app.skipped web',
			'deploy.started',
			'phase.finished validate',
			'phase.started plan',
			'resource.planned',
			'phase.finished plan',
			'deploy.finished',
		]);
		expect(globals.__gkmPlugin!.map(([phase]) => phase)).toEqual([
			'validate',
			'plan',
		]);
		// No lock, so no state directory.
		expect(existsSync(join(root, '.gkm'))).toBe(false);
	});

	it.each([
		['release', 'release broke'],
		['verify', 'api is not healthy'],
	])('rolls back when %s fails, then fails with what broke', async (phase, message) => {
		writeWorkspace(root, `['${PLUGIN}', { fail: '${phase}' }]`);

		const { events, result } = await run();

		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toBe(message);
		expect(globals.__gkmPlugin!.at(-1)).toEqual(['rollback', phase, message]);
		expect(sequence(events).slice(-4)).toEqual([
			`phase.failed ${phase}`,
			'phase.started rollback',
			'phase.finished rollback',
			'deploy.failed',
		]);
	});

	it("deploys through the host's own target before anything the config names", async () => {
		writeWorkspace(root, `'${PLUGIN}'`);
		const phases: string[] = [];
		const hosted = defineTarget({
			name: 'hosted',
			runtime: 'server',
			capabilities: { rollback: true, migrations: 'app', images: false },
			async validate() {
				phases.push('validate');
				return { at: 'host' };
			},
			async plan() {},
			async release() {
				phases.push('release');
				throw new Error('release broke');
			},
			async rollback() {
				throw new Error('rollback broke too');
			},
			result: () => {
				throw new Error('never reached');
			},
		});

		const { result } = await run({ targets: { acme: hosted } });

		expect(phases).toEqual(['validate', 'release']);
		expect(globals.__gkmPlugin).toEqual([]);
		expect(result).toBeInstanceOf(RollbackFailed);
		expect(result).toMatchObject({ target: 'acme' });
	});

	it('deploys through --target, moving every app on the default with it', async () => {
		writeWorkspace(root, `'${PLUGIN}'`);
		const phases: string[] = [];
		const other = defineTarget({
			name: 'other',
			runtime: 'server',
			capabilities: { rollback: false, migrations: 'app', images: false },
			async validate(ctx) {
				phases.push(`validate ${ctx.apps.join(',')}`);
			},
			async plan() {},
			async release() {},
			result: (ctx) => ({
				apps: [],
				projectId: '',
				environmentId: '',
				successCount: 0,
				failedCount: 0,
				stage: ctx.stage,
				identity: ctx.identity.key,
				tag: ctx.tag,
				dryRun: false,
				skipped: [...ctx.skipped],
				urls: {},
				changes: [],
			}),
		});

		const { result } = await run({
			target: 'other',
			targets: { other },
		});

		expect(phases).toEqual(['validate api']);
		expect(result).toMatchObject({ skipped: [{ app: 'web' }] });
	});

	it('fails validation, before anything runs, for a target nothing provides', async () => {
		writeWorkspace(root, `'${PLUGIN}'`);

		const { events, result } = await run({ target: 'kubernetes' });

		expect(result).toMatchObject({ name: 'UnknownDeployTarget' });
		expect(sequence(events)).toEqual([
			'phase.started validate',
			'phase.failed validate',
			'deploy.failed',
		]);
		expect(globals.__gkmPlugin).toEqual([]);
	});
});
