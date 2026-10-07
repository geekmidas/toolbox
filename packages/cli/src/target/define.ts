import type { AnyDeployTarget, DeployTarget } from './types';

/**
 * A deploy target, typed from what it is written with: the options from its
 * `options` schema, the run state from what `validate` returns. Nothing
 * happens at runtime — it returns the target as given.
 *
 * ```ts
 * export default defineTarget({
 *   name: 'fly',
 *   runtime: 'server',
 *   capabilities: { rollback: true, migrations: 'target', images: true },
 *   options: z.object({ org: z.string() }),
 *   async validate(ctx) {
 *     return { org: ctx.options.org }; // ctx.options: { org: string }
 *   },
 *   async release(ctx, run) { … },       // run: { org: string }
 *   …
 * });
 * ```
 */
export function defineTarget<Options = undefined, Run = void>(
	target: DeployTarget<Options, Run>,
): DeployTarget<Options, Run> {
	return target;
}

/** Whether `value` has the shape of a target. */
export function isDeployTarget(value: unknown): value is AnyDeployTarget {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.name === 'string' &&
		(candidate.runtime === 'server' || candidate.runtime === 'aws') &&
		typeof candidate.capabilities === 'object' &&
		candidate.capabilities !== null &&
		['validate', 'plan', 'release', 'result'].every(
			(phase) => typeof candidate[phase] === 'function',
		)
	);
}
