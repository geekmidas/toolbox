import { snifferContext } from '@geekmidas/constructs';
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import { api } from '../constructs/api.js';
import { auth } from '../constructs/auth.js';

interface HookContext {
	envParser: EnvironmentParser<any>;
	logger: Logger;
}

/**
 * Runs AFTER telescope middleware but BEFORE gkm endpoints — global middleware
 * and custom routes go here.
 */
export async function beforeSetup(app: Hono, ctx: HookContext) {
	ctx.logger.info('Running beforeSetup hook');

	// Who may call this API, read off the surface rather than listed here.
	//
	// The list used to be two hardcoded localhost ports, which was wrong in two
	// directions at once: it trusted an origin nothing was serving, and it was
	// unusable deployed, where the hosts are not localhost and not known when
	// this file is written. Now anything that declares an edge to `api` is on
	// it, and nothing else is — including, correctly, an empty list while
	// nothing does.
	const { origins } = ctx.envParser
		.create((get) => ({
			origins: get(api.keys.trustedOrigins)
				.string()
				.default('')
				.transform((value) =>
					value
						.split(',')
						.map((origin) => origin.trim())
						.filter(Boolean),
				),
		}))
		.parse();

	app.use(
		'*',
		cors({
			origin: origins,
			allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'Authorization'],
			credentials: true,
			maxAge: 86400,
		}),
	);

	// The auth server's own routes.
	//
	// The surface *is* declared now — `auth.declare()` returns a `rest-api` node
	// with its wildcard route on it, which is where the URL, the trusted origins
	// and the cookie domain come from. What has not landed is generating a
	// handler from that node, so the process still mounts it, and this hook goes
	// away when the build emits surfaces rather than when the kind exists.
	const server = await auth.service.register({
		envParser: ctx.envParser,
		context: snifferContext,
	});

	app.on(['GET', 'POST'], `${auth.basePath}/*`, (c) =>
		server.handler(c.req.raw),
	);
}

/**
 * Runs AFTER gkm endpoints — error handlers and fallbacks go here.
 */
export async function afterSetup(app: Hono, ctx: HookContext) {
	ctx.logger.info('Running afterSetup hook');

	app.onError((err, c) => {
		ctx.logger.error({ err: err.message }, 'Unhandled error');
		return c.json(
			{
				error: 'Internal Server Error',
				message:
					process.env.NODE_ENV === 'development' ? err.message : undefined,
			},
			500,
		);
	});

	app.notFound((c) =>
		c.json(
			{
				error: 'Not Found',
				message: `Route ${c.req.method} ${c.req.path} not found`,
			},
			404,
		),
	);
}
