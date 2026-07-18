import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Hono } from 'hono';
import { cors } from 'hono/cors';

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

	app.use(
		'*',
		cors({
			origin: ['http://localhost:3000', 'http://localhost:5173'],
			allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'Authorization'],
			credentials: true,
			maxAge: 86400,
		}),
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
