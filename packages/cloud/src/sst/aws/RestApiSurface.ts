import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `RestApiSurface` — an HTTP API, and the infra half of the `rest-api` kind.
 *
 * Deliberately *not* `Api`, which takes a route table and validates each
 * route's environment at synth. That component is the endpoint pipeline's, and
 * it needs routes; this one is the manifest's, and the manifest's `rest-api`
 * node currently carries `endpoints: []` for an application's own API.
 *
 * So what this provisions is the surface and nothing on it. An API Gateway with
 * no routes 404s everything, which is the honest state of things — and it is
 * still worth provisioning, because the *address* is what everything downstream
 * needs: a site inlines it as `VITE_API_URL`, an auth server puts it on its
 * trusted-origin list, and the cookie domain derives from it. Those are blocked
 * on the API existing, not on it answering.
 *
 * The two collapse into one component when the endpoint merge lands and the
 * surface node carries its routes.
 */

export interface RestApiSurfaceProps extends sst.aws.ApiGatewayV2Args {
	/**
	 * Who may call this surface, resolved after everything is provisioned.
	 *
	 * A promise rather than a value, because the answer depends on constructs
	 * that do not exist yet when this one is built — see `provides()`.
	 */
	callers?: Promise<{ trustedOrigins: string; cookieDomain?: string }>;
}
export class RestApiSurface<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.ApiGatewayV2
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.ApiGatewayV2;
	}

	private readonly callers: Promise<{
		trustedOrigins: string;
		cookieDomain?: string;
	}>;

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: RestApiSurfaceProps = {},
	) {
		const { callers, ...args } = props;

		super(name, args);
		this._id = name;
		this.callers = callers ?? Promise.resolve({ trustedOrigins: '' });
	}

	/**
	 * Where the surface answers, and who may call it.
	 *
	 * `trustedOrigins` and `cookieDomain` are declared by the construct and are
	 * *caller*-derived — read off the graph, not off this resource — so they are
	 * supplied through props rather than composed here. A surface knows its own
	 * address and nothing about who points at it.
	 */
	provides(): Record<string, $util.Input<string>> {
		return {
			url: this.url,
			// Lazy, and it has to be. A surface's callers include the site, and
			// the site's own build needs *this* surface's address — so the two
			// values are circular even though the two resources are not. A
			// promise resolved after everything is provisioned breaks it at the
			// value level, which is the level the cycle is actually on.
			trustedOrigins: $util.output(this.callers.then((c) => c.trustedOrigins)),
			cookieDomain: $util.output(
				this.callers.then((c) => c.cookieDomain ?? ''),
			),
		};
	}

	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, ...this.provides() },
		};
	}
}
