import path from 'node:path';
import {
	EnvValidationError,
	EnvValidator,
	type LinkRecord,
} from '@geekmidas/envkit/sst';
import { type GkmLinkable, ResourceType } from './Linkable';
import type { StackType } from './Stack';

/**
 * `Api` — wraps SST's `sst.aws.ApiGatewayV2` (HTTP API) with CORS defaults, a
 * typed route table, and per-route environment validation that fails at synth
 * time (before deploy) when a route requires variables its links cannot provide.
 *
 * NOTE: this module is distributed as raw TypeScript source. It extends the
 * ambient `sst.aws.*` globals that only exist inside an `sst install`ed app, so
 * it cannot be type-checked or built in this repo (see docs §2). It targets
 * SST v4 (ion); the route/auth shape follows the v3 reference and should be
 * verified against v4 in a consuming app.
 */
export class Api<
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

	constructor(stack: StackType<TStage, TDomain>, id: string, props: ApiProps) {
		const {
			links = [],
			routes,
			root = process.cwd(),
			vpc,
			environment: apiEnvironment,
			runtime: apiRuntime = 'nodejs24.x',
			...apiArgs
		} = props;

		// Pass the consumer's native `ApiGatewayV2Args` straight through — CORS,
		// domain, access logs, etc. are entirely the consumer's call.
		super(id, apiArgs);

		this._id = id;

		const relativeRoot = path.relative(process.cwd(), root);

		const environment = {
			REGION: stack.region,
			STAGE: stack.stage,
			NODE_ENV: 'production',
			APP_NAME: stack.app.name,
			...apiEnvironment,
		};

		// Bridge each infra-time link (`_id`/`_type`) to the runtime resolver shape
		// (`{ type }`) the validator expects, and keep the objects by name so we can
		// attach only the links a route actually needs (least privilege).
		const linkByName = new Map<string, GkmLinkable>(
			links.map((link) => [link._id, link]),
		);
		const linkRecord: LinkRecord = Object.fromEntries(
			links.map((link) => [link._id, { type: link._type }]),
		);

		// Same links + whitelist for every route, so build the validator once; the
		// failing route is identified via the per-route error context below.
		const validator = new EnvValidator(linkRecord, {
			platform: 'aws',
			whitelist: Object.keys(environment),
		});

		const failures: EnvValidationError[] = [];

		for (const route of routes) {
			const routeKey = `${route.method} ${route.path}`;
			const names = route.environment ?? [];

			const result = validator.validate(names);
			if (!result.valid) {
				failures.push(
					new EnvValidationError({
						missing: result.invalidVars,
						available: validator.availableVars,
						linkVars: validator.linkVars,
						suggestions: result.suggestions,
						context: `${id} ${routeKey}`,
					}),
				);
			}

			const link = validator
				.getProvidersForEnvVars(names)
				.map((name) => linkByName.get(name))
				.filter((l): l is GkmLinkable => l !== undefined);

			const auth =
				route.authorizer === 'iam' ? { auth: { iam: true } } : undefined;

			this.route(
				routeKey,
				{
					handler: path.join(relativeRoot, route.handler),
					vpc,
					environment,
					link,
					runtime: route.runtime ?? apiRuntime,
					nodejs: route.nodejs,
				},
				auth,
			);
		}

		// Fail the whole synth if any route is misconfigured, with one actionable
		// message per offending route.
		if (failures.length) {
			throw new Error(failures.map((f) => f.message).join('\n\n'));
		}
	}
}

export interface Route {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
	path: string;
	/** Handler entrypoint, resolved relative to `root` (default `cwd`). */
	handler: string;
	/** Required env vars for this route; validated against `links`. */
	environment?: readonly string[];
	/**
	 * Authorization for this route.
	 * - `iam`: requires AWS SigV4 signed requests
	 * - `none` (default): public
	 * Custom Lambda authorizers are deferred (see docs §11.4).
	 */
	authorizer?: 'iam' | 'none';
	nodejs?: { install?: string[]; externals?: string[] };
	/** Lambda runtime for this route. Overrides the API default (`nodejs24.x`). */
	runtime?: sst.aws.FunctionArgs['runtime'];
}

/**
 * `ApiProps` extends SST's native `sst.aws.ApiGatewayV2Args`, so every native
 * option (`cors`, `domain`, `accessLog`, `transform`, …) passes straight
 * through untouched. We only add the route table and the linking/validation
 * inputs on top.
 */
export interface ApiProps extends sst.aws.ApiGatewayV2Args {
	routes: Route[];
	/** Pool of linkable resources routes may draw on. */
	links?: GkmLinkable[];
	/** Base directory for resolving route `handler` paths. Defaults to `cwd`. */
	root?: string;
	/** Env vars applied to every route, merged over the API defaults. */
	environment?: Record<string, string>;
	/** VPC to place each route's Lambda in. */
	vpc?: sst.aws.Vpc;
	/** Default Lambda runtime for every route. Defaults to `nodejs24.x`; a route
	 * may override it. */
	runtime?: sst.aws.FunctionArgs['runtime'];
}
