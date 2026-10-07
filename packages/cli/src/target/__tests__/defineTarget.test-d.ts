/**
 * What `defineTarget` infers, checked by the compiler (`*.test-d.ts`: Vitest
 * typechecks it, and `tsc` compiles it with the sources): the options from
 * the schema, the run state from `validate`. And the targets that are still to
 * come, written out as declarations, to show the interface holds them.
 */

import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { ComposeStack } from '../../compose/stack';
import type { DeployResult } from '../../deploy/types';
import { defineTarget } from '../define';
import type {
	DeployPhaseContext,
	DeployTarget,
	DeployTargetCapabilities,
	DeployTargetEntry,
	TargetOptions,
} from '../types';

declare const result: DeployResult;

describe('defineTarget', () => {
	it('types ctx.options from the options schema, defaults applied', () => {
		const target = defineTarget({
			name: 'fly',
			runtime: 'server',
			capabilities: { rollback: true, migrations: 'target', images: true },
			options: z.object({
				org: z.string(),
				region: z.string().default('ams'),
				machines: z.number().optional(),
			}),
			async validate(ctx) {
				expectTypeOf(ctx.options).toEqualTypeOf<{
					org: string;
					region: string;
					machines?: number | undefined;
				}>();
				return { org: ctx.options.org, started: Date.now() };
			},
			async plan(_ctx, run) {
				expectTypeOf(run).toEqualTypeOf<{ org: string; started: number }>();
			},
			async release(ctx, run) {
				expectTypeOf(ctx.options.region).toBeString();
				expectTypeOf(run.org).toBeString();
			},
			async rollback(_ctx, run, failure) {
				expectTypeOf(run.started).toBeNumber();
				expectTypeOf(failure.phase).toEqualTypeOf<'release' | 'verify'>();
			},
			result: () => result,
		});

		expectTypeOf<TargetOptions<typeof target>>().toEqualTypeOf<{
			org: string;
			region: string;
			machines?: number | undefined;
		}>();
	});

	it('gives a target without a schema no options', () => {
		const target = defineTarget({
			name: 'bare',
			runtime: 'aws',
			capabilities: { rollback: false, migrations: 'app', images: false },
			async validate(ctx) {
				expectTypeOf(ctx.options).toEqualTypeOf<undefined>();
			},
			async plan(_ctx, run) {
				expectTypeOf(run).toEqualTypeOf<void>();
			},
			async release() {},
			result: () => result,
		});

		expectTypeOf(target).toEqualTypeOf<DeployTarget<undefined, void>>();
	});

	it('refuses phases that do not fit', () => {
		defineTarget({
			name: 'wrong',
			// @ts-expect-error: a runtime is server or aws
			runtime: 'lambda',
			capabilities: { rollback: false, migrations: 'app', images: false },
			async validate() {},
			async plan() {},
			async release() {},
			result: () => result,
		});

		defineTarget({
			name: 'wrong',
			runtime: 'server',
			// @ts-expect-error: who runs migrations is the target or the app
			capabilities: { rollback: false, migrations: 'someone', images: false },
			async validate() {},
			async plan() {},
			async release() {},
			result: () => result,
		});

		// @ts-expect-error: release and result are required
		defineTarget({
			name: 'wrong',
			runtime: 'server',
			capabilities: { rollback: false, migrations: 'app', images: false },
			async validate() {},
			async plan() {},
		});
	});

	it('takes every kind of deploy.targets entry', () => {
		const target = defineTarget({
			name: 'inline',
			runtime: 'server',
			capabilities: { rollback: false, migrations: 'app', images: false },
			options: z.object({ org: z.string() }),
			async validate() {},
			async plan() {},
			async release() {},
			result: () => result,
		});

		expectTypeOf('@acme/gkm-target').toExtend<DeployTargetEntry>();
		expectTypeOf(target).toExtend<DeployTargetEntry>();
		expectTypeOf([
			'@acme/gkm-target',
			{ region: 'ams' },
		] as const).toExtend<DeployTargetEntry>();
		expectTypeOf([
			target,
			{ org: 'acme' },
		] as const).toExtend<DeployTargetEntry>();
	});
});

/**
 * The targets still to be written, declared as their issues describe them.
 * They compile, which is the point: the interface can express each.
 */
describe('targets to come', () => {
	it('SST (#152): AWS, no images, migrations its own, no rollback', () => {
		const sst = defineTarget({
			name: 'sst',
			runtime: 'aws',
			capabilities: { rollback: false, migrations: 'target', images: false },
			// AWS credentials, through the run's provider.
			credentials: [],
			async validate(ctx) {
				// `sst.config.ts` at the root; the stage's AWS profile.
				return {
					config: `${ctx.cwd}/sst.config.ts`,
					outputs: {} as Record<string, string>,
				};
			},
			async plan() {},
			// `gkm build --provider aws --stage <s>`
			async build() {},
			// `sst deploy --stage <s>`, AWS credentials in that exec's env only
			async release(_ctx, run) {
				run.outputs.api = 'https://api.example.com';
			},
			// Health checks against the surface URLs in the SST outputs.
			async verify(ctx, run) {
				for (const [app, url] of Object.entries(run.outputs)) {
					ctx.emit({
						type: 'health.checked',
						app,
						url,
						healthy: true,
						attempt: 1,
					});
				}
			},
			result: () => result,
		});

		expectTypeOf(sst.capabilities).toEqualTypeOf<DeployTargetCapabilities>();
		expectTypeOf(sst.build).not.toBeUndefined();
	});

	it('compose: a server stack whose plan is the pure composeStack()', () => {
		const compose = defineTarget({
			name: 'compose',
			runtime: 'server',
			capabilities: { rollback: false, migrations: 'target', images: true },
			// `--tag v1.4.0` pulls what CI pushed; no tag builds from the checkout.
			options: z.object({
				tag: z.string().optional(),
				pull: z.boolean().default(false),
			}),
			async validate(
				ctx,
			): Promise<{ stack?: ComposeStack; mode: 'build' | 'pull' }> {
				// In pull mode every image is looked up before anything else.
				return { mode: ctx.options.tag ? 'pull' : 'build' };
			},
			// `composeStack(…)` is pure: the files a dry run would write.
			async plan() {},
			// Infra up, databases/roles/grants, migrations.
			async provision() {},
			// The host bundle and the image builds, through the injected Docker.
			async build(ctx, run) {
				expectTypeOf(run.mode).toEqualTypeOf<'build' | 'pull'>();
				expectTypeOf(ctx).toEqualTypeOf<
					DeployPhaseContext<{ tag?: string | undefined; pull: boolean }>
				>();
			},
			// `up --wait --remove-orphans`, then each app's tag and digest in state.
			async release() {},
			async verify() {},
			result: () => result,
		});

		expectTypeOf(compose.options).not.toBeUndefined();
	});
});
