import {
	EnvValidator,
	type LinkRecord,
	type ValidationResult,
} from '@geekmidas/envkit/sst';
import { type GkmLinkable, ResourceType } from './Linkable';
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
			NODE_ENV: 'production',
			SERVICE_NAME: id,
			STAGE: stack.stage,
			REGION: stack.region,
			APP_NAME: stack.app.name,
			...environment,
		};

		// Bridge the infra-time links (`_id`/`_type`) to the runtime resolver shape
		// (`{ type }`) the validator expects, and keep the objects by name so only
		// the links this function needs are attached (least privilege).
		const linkByName = new Map<string, GkmLinkable>(
			links.map((link) => [link._id, link]),
		);
		const linkRecord: LinkRecord = Object.fromEntries(
			links.map((link) => [link._id, { type: link._type }]),
		);

		const validator = new EnvValidator(linkRecord, {
			platform: 'aws',
			whitelist: Object.keys(mergedEnvironment),
			context: id,
		});
		if (autoValidate) {
			validator.assert(envVars);
		}

		const link = validator
			.getProvidersForEnvVars(envVars)
			.map((name) => linkByName.get(name))
			.filter((l): l is GkmLinkable => l !== undefined);

		super(id, {
			...fnArgs,
			environment: mergedEnvironment,
			// Linking is managed via the `links`/`envVars` flow, so this overrides
			// any native `link` passed through `fnArgs`.
			link,
			runtime: runtime ?? 'nodejs24.x',
			logging: logging ?? { format: 'json' },
		});

		this._id = id;
		this.validator = validator;
		this.envVars = envVars;
	}

	/** Re-runs validation and returns the result (does not throw). */
	validate(): ValidationResult {
		return this.validator.validate(this.envVars);
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
