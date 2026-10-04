import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `RestApiSurface` — an HTTP API, and the infra half of the `rest-api` kind.
 *
 * Provisioned before its routes, because its *address* is what everything
 * downstream needs: a site inlines it as `VITE_API_URL`, an auth server puts it
 * on its trusted-origin list, and the cookie domain derives from it. The routes
 * are mounted once everything they link to exists — see {@link mount}.
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

	/**
	 * Mount one endpoint: a Lambda running the handler the build wrote for it,
	 * linked to exactly what that endpoint depends on.
	 */
	mount(endpoint: SurfaceRoute) {
		return this.route(
			`${endpoint.method} ${endpoint.path}`,
			{
				handler: endpoint.handler,
				link: endpoint.link ?? [],
				runtime: 'nodejs24.x',
				...(endpoint.vpc ? { vpc: endpoint.vpc } : {}),
			},
			// `iam` is the one authorizer the gateway enforces itself; every other
			// is the endpoint's own, checked in the handler.
			endpoint.authorizer === 'iam' ? { auth: { iam: true } } : {},
		);
	}

	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, ...this.provides() },
		};
	}
}

/** One endpoint, as {@link RestApiSurface.mount} mounts it. */
export interface SurfaceRoute {
	method: string;
	path: string;
	/** The built handler — `apps/api/.gkm/aws/routes/getUser.handler`. */
	handler: string;
	/** What the endpoint depends on, and nothing else. */
	link?: unknown[];
	/** The database's network, when the endpoint reaches one. */
	vpc?: sst.aws.Vpc;
	authorizer?: string;
}
