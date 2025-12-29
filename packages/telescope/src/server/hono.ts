import { Hono } from 'hono';
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { Telescope } from '../Telescope';
import type { QueryOptions } from '../types';
import { getAsset, getIndexHtml } from '../ui-assets';

const CONTEXT_KEY = 'telescope-request-id';

/**
 * Create Hono middleware that captures requests and responses
 */
export function createMiddleware(telescope: Telescope): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    if (!telescope.enabled) {
      return next();
    }

    if (telescope.shouldIgnore(c.req.path)) {
      return next();
    }

    const startTime = performance.now();

    // Capture request data
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const url = new URL(c.req.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    let body: unknown;
    if (
      telescope.recordBody &&
      ['POST', 'PUT', 'PATCH'].includes(c.req.method)
    ) {
      try {
        const contentType = c.req.header('content-type') || '';
        if (contentType.includes('application/json')) {
          body = await c.req.json();
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const formData = await c.req.formData();
          body = Object.fromEntries(formData.entries());
        } else if (contentType.includes('text/')) {
          body = await c.req.text();
        }
      } catch {
        // Ignore body parsing errors
      }
    }

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');

    try {
      await next();

      // Capture response data
      const duration = performance.now() - startTime;

      const responseHeaders: Record<string, string> = {};
      c.res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseBody: unknown;
      if (telescope.recordBody) {
        try {
          const contentType = c.res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const cloned = c.res.clone();
            responseBody = await cloned.json();
          }
        } catch {
          // Ignore body parsing errors
        }
      }

      const requestId = await telescope.recordRequest({
        method: c.req.method,
        path: c.req.path,
        url: c.req.url,
        headers,
        body,
        query,
        status: c.res.status,
        responseHeaders,
        responseBody,
        duration,
        ip,
      });

      c.set(CONTEXT_KEY, requestId);
    } catch (error) {
      await telescope.exception(error as Error);
      throw error;
    }
  };
}

/**
 * Parse query options from Hono context
 */
function parseQueryOptions(c: Context): QueryOptions {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search');
  const before = c.req.query('before');
  const after = c.req.query('after');
  const tags = c.req.query('tags')?.split(',').filter(Boolean);

  return {
    limit: Math.min(limit, 100),
    offset,
    search,
    before: before ? new Date(before) : undefined,
    after: after ? new Date(after) : undefined,
    tags,
  };
}

/**
 * Create Hono app with dashboard UI and API routes
 */
export function createUI(telescope: Telescope): Hono {
  const app = new Hono();

  // API routes
  app.get('/api/requests', async (c) => {
    const options = parseQueryOptions(c);
    const requests = await telescope.getRequests(options);
    return c.json(requests);
  });

  app.get('/api/requests/:id', async (c) => {
    const request = await telescope.getRequest(c.req.param('id'));
    if (!request) {
      return c.json({ error: 'Request not found' }, 404);
    }
    return c.json(request);
  });

  app.get('/api/exceptions', async (c) => {
    const options = parseQueryOptions(c);
    const exceptions = await telescope.getExceptions(options);
    return c.json(exceptions);
  });

  app.get('/api/exceptions/:id', async (c) => {
    const exception = await telescope.getException(c.req.param('id'));
    if (!exception) {
      return c.json({ error: 'Exception not found' }, 404);
    }
    return c.json(exception);
  });

  app.get('/api/logs', async (c) => {
    const options = parseQueryOptions(c);
    const logs = await telescope.getLogs(options);
    return c.json(logs);
  });

  app.get('/api/stats', async (c) => {
    const stats = await telescope.getStats();
    return c.json(stats);
  });

  // Static assets
  app.get('/assets/:filename', (c) => {
    const filename = c.req.param('filename');
    const assetPath = `assets/${filename}`;
    const asset = getAsset(assetPath);
    if (asset) {
      return c.body(asset.content, 200, {
        'Content-Type': asset.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
    }
    return c.notFound();
  });

  // Dashboard UI - serve React app
  app.get('/', (c) => {
    const html = getIndexHtml();
    if (html) {
      return c.html(html);
    }
    // Fallback to inline HTML if UI assets not available
    return c.html(telescope.getDashboardHtml());
  });

  app.get('/*', (c) => {
    // SPA fallback - serve index.html for client-side routing
    const html = getIndexHtml();
    if (html) {
      return c.html(html);
    }
    return c.html(telescope.getDashboardHtml());
  });

  return app;
}

/**
 * Set up WebSocket routes for real-time updates.
 * Requires @hono/node-ws for Node.js or Bun's built-in WebSocket.
 */
export function setupWebSocket(
  app: Hono,
  telescope: Telescope,
  upgradeWebSocket: (handler: any) => any,
): void {
  app.get(
    '/ws',
    upgradeWebSocket(() => ({
      onOpen: (_event: Event, ws: WebSocket) => {
        telescope.addWsClient(ws);
      },
      onClose: (_event: Event, ws: WebSocket) => {
        telescope.removeWsClient(ws);
      },
      onMessage: (event: MessageEvent, ws: WebSocket) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore invalid messages
        }
      },
    })),
  );
}

/**
 * Get the request ID from Hono context (set by middleware)
 */
export function getRequestId(c: Context): string | undefined {
  return c.get(CONTEXT_KEY);
}

// Re-export types
export type { Telescope };
