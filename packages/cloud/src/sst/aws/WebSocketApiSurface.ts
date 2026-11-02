import { apiGatewayWebSocketUrl } from '@geekmidas/manifest';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `WebSocketApiSurface` — an API Gateway WebSocket API, and the infra half of
 * the `websocket-api` kind on AWS.
 *
 * The same surface a compose stage runs as a Node process: there the process
 * holds the sockets and Redis carries a send to whichever replica holds one;
 * here API Gateway holds them, and each route is a Lambda the build wrote
 * (`AmazonApiGatewayWebSocket`). What the gateway does not keep — a
 * connection's `data`, and the list a broadcast fans out to — goes in a
 * DynamoDB table this component makes beside the API, so a surface declares
 * nothing more to deploy here.
 *
 * Linked, it hands a function its `<ID>_URL` (`wss://`), its
 * `<ID>_TRUSTED_ORIGINS`, and an `apigateway://` publisher string naming the
 * management endpoint and the table — with `execute-api:ManageConnections`
 * and the table's access, so `services.<surface>` works from any Lambda that
 * declared the edge, and from the surface's own routes.
 */

export interface WebSocketApiSurfaceProps
	extends sst.aws.ApiGatewayWebSocketArgs {
	/** Who may open it, resolved once everything is provisioned. */
	callers?: Promise<{ trustedOrigins: string; cookieDomain?: string }>;
	/**
	 * The key a frame names its action under — the surface's
	 * `frame.discriminator`. Absent, `action`.
	 */
	discriminator?: string;
}

export class WebSocketApiSurface<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.ApiGatewayWebSocket
	implements GkmLinkable
{
	readonly _id!: string;

	/** Where its open connections are kept. */
	readonly connections: sst.aws.Dynamo;

	get _type() {
		return ResourceType.WebSocketApi;
	}

	private readonly callers: Promise<{ trustedOrigins: string }>;

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: WebSocketApiSurfaceProps = {},
	) {
		const { callers, discriminator, ...args } = props;
		const own = args.transform?.api;
		// API Gateway routes on the key the surface's frames name their action
		// under — the route a frame reaches is the one `message()` would
		// dispatch it to. The caller's own transform still runs after it.
		const api = ((
			apiArgs: { routeSelectionExpression?: unknown },
			...rest: unknown[]
		) => {
			apiArgs.routeSelectionExpression =
				routeSelectionExpression(discriminator);
			if (typeof own === 'function') {
				(own as (...a: unknown[]) => void)(apiArgs, ...rest);
			} else if (own) {
				Object.assign(apiArgs, own);
			}
		}) as NonNullable<
			NonNullable<sst.aws.ApiGatewayWebSocketArgs['transform']>['api']
		>;

		super(name, { ...args, transform: { ...args.transform, api } });
		this._id = name;
		this.callers = callers ?? Promise.resolve({ trustedOrigins: '' });
		this.connections = new sst.aws.Dynamo(`${name}Connections`, {
			fields: { connectionId: 'string' },
			primaryIndex: { hashKey: 'connectionId' },
			// API Gateway closes a connection after two hours; a row whose
			// `$disconnect` never ran expires after that.
			ttl: 'expiresAt',
		});
	}

	provides(): Record<string, $util.Input<string>> {
		return {
			url: this.url,
			// Deferred for the reason a REST surface's are: a caller's address
			// is known only once it is provisioned. See `RestApiSurface`.
			trustedOrigins: $util.output(this.callers.then((c) => c.trustedOrigins)),
			publisherConnectionString: $util
				.all([this.managementEndpoint, this.connections.name])
				.apply(([endpoint, table]) =>
					apiGatewayWebSocketUrl({
						region:
							regionOfEndpoint(endpoint as string) ??
							$app.providers?.aws?.region ??
							'us-east-1',
						endpoint: endpoint as string,
						table: table as string,
					}),
				),
		};
	}

	/**
	 * Mount one route: a Lambda running the handler the build wrote for it,
	 * linked to what that route depends on and to the surface itself — its
	 * table and its management API, which every route reaches.
	 */
	mount(route: WebSocketSurfaceRoute) {
		return this.route(route.action, {
			handler: route.handler,
			link: [this, ...(route.link ?? []).filter((link) => link !== this)],
			runtime: 'nodejs24.x',
			...(route.vpc ? { vpc: route.vpc } : {}),
		});
	}

	override getSSTLink() {
		const own = super.getSSTLink();
		const table = this.connections.getSSTLink();
		return {
			...own,
			properties: { ...own.properties, ...this.provides() },
			include: [...(own.include ?? []), ...(table.include ?? [])],
		};
	}
}

/** One route, as {@link WebSocketApiSurface.mount} mounts it. */
export interface WebSocketSurfaceRoute {
	/** The route key: an action, `$connect`, `$disconnect` or `$default`. */
	action: string;
	/** The built handler — `apps/realtime/.gkm/aws/websocket/connect.handler`. */
	handler: string;
	/** What the route depends on; the surface itself is added. */
	link?: unknown[];
	/** The database's network, when the route reaches one. */
	vpc?: sst.aws.Vpc;
}

/** `$request.body.<key>`, the key a surface's frames name their action under. */
export function routeSelectionExpression(discriminator?: string): string {
	return `$request.body.${discriminator ?? 'action'}`;
}

/** The region in a management endpoint's host: `<api>.execute-api.<region>.…`. */
export function regionOfEndpoint(endpoint: string): string | undefined {
	try {
		return /\.execute-api\.([a-z0-9-]+)\./.exec(new URL(endpoint).host)?.[1];
	} catch {
		return undefined;
	}
}
