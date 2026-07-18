import type { EnvValidator, ValidationResult } from '@geekmidas/envkit/sst';
import {
	type FunctionInfo,
	flattenManifestField,
	type ManifestField,
} from '@geekmidas/manifest';
import { type GkmLinkable, ResourceType } from './Linkable';
import { LinkedEnvironment } from './LinkedEnvironment';
import type { StackType } from './Stack';

/**
 * `Function` — wraps SST's `sst.aws.Function` with standard env defaults and
 * before-deploy env-var validation.
 *
 * `FunctionProps` extends the native `sst.aws.FunctionArgs`, so every native
 * option (`handler`, `name`, `nodejs`, `vpc`, `url`, `permissions`, …) passes
 * through; the construct only merges env defaults, defaults the runtime to
 * `nodejs24.x` and JSON logging (both overridable), and resolves/validates
 * `link` from the `links` pool against the required `envVars`.
 *
 * Source-only (extends ambient `sst.aws.*`); see docs §2.
 */
export class Function<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.Function
	implements GkmLinkable
{
	readonly _id!: string;
	private readonly validator: EnvValidator;
	private readonly envVars: readonly string[];

	get _type() {
		return ResourceType.Function;
	}

	constructor(
		stack: StackType<TStage, TDomain>,
		id: string,
		props: FunctionProps,
	) {
		const {
			links = [],
			envVars = [],
			autoValidate = true,
			environment,
			runtime,
			logging,
			...fnArgs
		} = props;

		const mergedEnvironment = {
			...LinkedEnvironment.createBaseEnvironment(stack, id),
			...environment,
		};

		const linked = new LinkedEnvironment(links, {
			whitelist: Object.keys(mergedEnvironment),
			context: id,
		});
		if (autoValidate) {
			linked.validator.assert(envVars);
		}

		super(id, {
			...fnArgs,
			environment: mergedEnvironment,
			// Linking is managed via the `links`/`envVars` flow, so this overrides
			// any native `link` passed through `fnArgs`.
			link: linked.resolveLink(envVars),
			runtime: runtime ?? 'nodejs24.x',
			logging: logging ?? { format: 'json' },
		});

		this._id = id;
		this.validator = linked.validator;
		this.envVars = envVars;
	}

	/** Re-runs validation and returns the result (does not throw). */
	validate(): ValidationResult {
		return this.validator.validate(this.envVars);
	}

	/**
	 * Build one `Function` per entry in a `gkm build` manifest's `functions`
	 * field (flat or partitioned). Shared `props` (e.g. `links`) apply to every
	 * function.
	 *
	 * ```ts
	 * Function.fromManifest(stack, manifest.functions, { links: [db] });
	 * ```
	 */
	static fromManifest<
		TStage extends string = string,
		TDomain extends string = string,
	>(
		stack: StackType<TStage, TDomain>,
		functions: ManifestField<FunctionInfo>,
		props: Omit<FunctionProps, 'handler'> = {},
	): Function<TStage, TDomain>[] {
		return flattenManifestField(functions).map(
			(fn) =>
				new Function(stack, fn.name, {
					...props,
					name: stack.logicalPrefixedName(fn.name),
					handler: fn.handler,
					envVars: fn.environment,
					timeout: fn.timeout ? `${fn.timeout} seconds` : undefined,
					memory: fn.memorySize ? `${fn.memorySize} MB` : undefined,
				}),
		);
	}
}

export interface FunctionProps extends sst.aws.FunctionArgs {
	/** Required env vars for this function; validated against `links`. */
	envVars?: readonly string[];
	/** Pool of linkable resources `envVars` are resolved and validated against. */
	links?: GkmLinkable[];
	/**
	 * Validate `envVars` against the links in the constructor (fails synth before
	 * deploy on a missing variable).
	 * @default true
	 */
	autoValidate?: boolean;
}
