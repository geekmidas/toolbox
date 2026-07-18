import { EnvValidator, type LinkRecord } from '@geekmidas/envkit/sst';
import type { GkmLinkable } from './Linkable';
import type { StackType } from './Stack';

/**
 * Shared environment defaults + env-var validation + least-privilege linking for
 * the Lambda-backed constructs — `Function` (once) and `Api` (per route).
 * Bridges infra-time links (`_id`/`_type`) to the runtime resolver shape, builds
 * one `EnvValidator`, and resolves the minimal set of links a required-vars set
 * needs.
 *
 * Used by **composition**, not inheritance: the constructs already extend their
 * SST base component (`sst.aws.Function` / `sst.aws.ApiGatewayV2`), so they hold
 * a `LinkedEnvironment` rather than subclassing a common base.
 */
export class LinkedEnvironment {
	readonly validator: EnvValidator;
	private readonly linkByName: Map<string, GkmLinkable>;

	constructor(
		links: GkmLinkable[],
		options: { whitelist: readonly string[]; context?: string },
	) {
		this.linkByName = new Map(links.map((link) => [link._id, link]));
		const linkRecord: LinkRecord = Object.fromEntries(
			links.map((link) => [link._id, { type: link._type }]),
		);
		this.validator = new EnvValidator(linkRecord, {
			platform: 'aws',
			whitelist: options.whitelist,
			context: options.context,
		});
	}

	/**
	 * The standard environment defaults every Lambda-backed construct injects from
	 * its stack. `serviceName` adds `SERVICE_NAME` (functions set it to their id;
	 * the API leaves it off). Callers spread their own `environment` over the
	 * result, so the user's values always win.
	 */
	static createBaseEnvironment<TStage extends string, TDomain extends string>(
		stack: StackType<TStage, TDomain>,
		serviceName?: string,
	): Record<string, string> {
		return {
			NODE_ENV: 'production',
			...(serviceName ? { SERVICE_NAME: serviceName } : {}),
			STAGE: stack.stage,
			REGION: stack.region,
			APP_NAME: stack.app.name,
		};
	}

	/** The link objects that provide at least one of `envVars` (least privilege). */
	resolveLink(envVars: readonly string[]): GkmLinkable[] {
		return this.validator
			.getProvidersForEnvVars(envVars)
			.map((name) => this.linkByName.get(name))
			.filter((link): link is GkmLinkable => link !== undefined);
	}
}
