import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Hono } from 'hono';
import { cors } from 'hono/cors';

interface HookContext {
  envParser: EnvironmentParser<any>;
  logger: Logger;
}

/**
 * Called AFTER telescope middleware (so requests are captured) but BEFORE
 * studio and gkm endpoints are registered.
 * Use this for global middleware and custom routes.
 */
export async function beforeSetup(app: Hono, ctx: HookContext) {
  ctx.logger.info('Running beforeSetup hook');

  // Add CORS middleware
  app.use(
    '*',
    cors({
      origin: ['http://localhost:3000', 'http://localhost:5173'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['X-Request-Id'],
      credentials: true,
      maxAge: 86400,
    }),
  );

  // Add a custom health endpoint (before gkm endpoints)
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Add a webhook endpoint (useful for third-party integrations)
  app.post('/webhooks/:provider', async (c) => {
    const provider = c.req.param('provider');
    const body = await c.req.json();
    ctx.logger.info({ provider, body }, 'Received webhook');
    return c.json({ received: true, provider });
  });
}

/**
 * Called AFTER gkm endpoints are registered.
 * Use this for error handlers and fallback routes.
 */
export async function afterSetup(app: Hono, ctx: HookContext) {
  ctx.logger.info('Running afterSetup hook');

  // Global error handler
  app.onError((err, c) => {
    ctx.logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
    return c.json(
      {
        error: 'Internal Server Error',
        message:
          process.env.NODE_ENV === 'development' ? err.message : undefined,
      },
      500,
    );
  });

  // Custom 404 handler
  app.notFound((c) => {
    return c.json(
      {
        error: 'Not Found',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      404,
    );
  });
}
