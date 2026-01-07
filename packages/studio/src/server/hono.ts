import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Studio } from '../Studio';
import type { DataBrowser } from '../data/DataBrowser';
import {
  Direction,
  type FilterCondition,
  FilterOperator,
  type SortConfig,
} from '../types';
import { getAsset, getIndexHtml } from '../ui-assets';

/**
 * Interface for the Studio instance used by the Hono adapter.
 */
export interface StudioLike {
  data: DataBrowser<unknown>;
  // Monitoring methods
  getRequests: Studio<unknown>['getRequests'];
  getRequest: Studio<unknown>['getRequest'];
  getExceptions: Studio<unknown>['getExceptions'];
  getException: Studio<unknown>['getException'];
  getLogs: Studio<unknown>['getLogs'];
  getStats: Studio<unknown>['getStats'];
  // Metrics methods
  getMetrics: Studio<unknown>['getMetrics'];
  getEndpointMetrics: Studio<unknown>['getEndpointMetrics'];
  getEndpointDetails: Studio<unknown>['getEndpointDetails'];
  getStatusDistribution: Studio<unknown>['getStatusDistribution'];
  resetMetrics: Studio<unknown>['resetMetrics'];
}

/**
 * Parse filter conditions from query parameters.
 * Format: filter[column][operator]=value
 * Example: filter[name][eq]=John&filter[age][gt]=18
 */
function parseFilters(c: Context): FilterCondition[] {
  const filters: FilterCondition[] = [];
  const url = new URL(c.req.url);

  url.searchParams.forEach((value, key) => {
    const match = key.match(/^filter\[(\w+)\]\[(\w+)\]$/);
    if (match) {
      const column = match[1];
      const operator = match[2];
      if (!column || !operator) return;

      const op = operator as FilterOperator;

      // Validate operator
      if (!Object.values(FilterOperator).includes(op)) {
        return;
      }

      // Handle special cases
      if (op === FilterOperator.In || op === FilterOperator.Nin) {
        filters.push({ column, operator: op, value: value.split(',') });
      } else if (
        op === FilterOperator.IsNull ||
        op === FilterOperator.IsNotNull
      ) {
        filters.push({ column, operator: op });
      } else {
        // Try to parse as number or boolean
        let parsedValue: unknown = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (!isNaN(Number(value)) && value !== '')
          parsedValue = Number(value);

        filters.push({ column, operator: op, value: parsedValue });
      }
    }
  });

  return filters;
}

/**
 * Parse sort configuration from query parameters.
 * Format: sort=column:direction,column:direction
 * Example: sort=name:asc,created_at:desc
 */
function parseSort(c: Context): SortConfig[] {
  const sortParam = c.req.query('sort');
  if (!sortParam) return [];

  return sortParam
    .split(',')
    .map((part) => {
      const parts = part.split(':');
      const column = parts[0];
      const dir = parts[1];
      if (!column) return null;
      return {
        column,
        direction: dir === 'desc' ? Direction.Desc : Direction.Asc,
      };
    })
    .filter((s): s is SortConfig => s !== null);
}

/**
 * Parse query options for monitoring endpoints.
 */
function parseQueryOptions(c: Context) {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search');
  const before = c.req.query('before');
  const after = c.req.query('after');
  const tags = c.req.query('tags')?.split(',').filter(Boolean);
  const method = c.req.query('method');
  const status = c.req.query('status');
  const level = c.req.query('level') as
    | 'debug'
    | 'info'
    | 'warn'
    | 'error'
    | undefined;

  return {
    limit: Math.min(limit, 100),
    offset,
    search,
    before: before ? new Date(before) : undefined,
    after: after ? new Date(after) : undefined,
    tags,
    method: method || undefined,
    status: status || undefined,
    level: level || undefined,
  };
}

/**
 * Parse metrics query options from query parameters.
 */
function parseMetricsQueryOptions(c: Context) {
  const start = c.req.query('start');
  const end = c.req.query('end');
  const bucketSize = c.req.query('bucketSize');
  const limit = c.req.query('limit');

  return {
    range:
      start && end ? { start: new Date(start), end: new Date(end) } : undefined,
    bucketSize: bucketSize ? parseInt(bucketSize, 10) : undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
  };
}

/**
 * Create Hono app with Studio API routes and dashboard UI.
 */
export function createStudioApp(studio: StudioLike): Hono {
  const app = new Hono();

  // ============================================
  // Database API
  // ============================================

  /**
   * GET /api/schema
   * Get the complete database schema
   */
  app.get('/api/schema', async (c) => {
    const forceRefresh = c.req.query('refresh') === 'true';
    const schema = await studio.data.getSchema(forceRefresh);
    return c.json(schema);
  });

  /**
   * GET /api/tables
   * List all tables with basic info
   */
  app.get('/api/tables', async (c) => {
    const schema = await studio.data.getSchema();
    const tables = schema.tables.map((t) => ({
      name: t.name,
      schema: t.schema,
      columnCount: t.columns.length,
      primaryKey: t.primaryKey,
      estimatedRowCount: t.estimatedRowCount,
    }));
    return c.json({ tables });
  });

  /**
   * GET /api/tables/:name
   * Get detailed information about a specific table
   */
  app.get('/api/tables/:name', async (c) => {
    const tableName = c.req.param('name');
    const tableInfo = await studio.data.getTableInfo(tableName);

    if (!tableInfo) {
      return c.json({ error: `Table '${tableName}' not found` }, 404);
    }

    return c.json(tableInfo);
  });

  /**
   * GET /api/tables/:name/rows
   * Query table data with pagination, filtering, and sorting
   */
  app.get('/api/tables/:name/rows', async (c) => {
    const tableName = c.req.param('name');
    const pageSize = Math.min(
      parseInt(c.req.query('pageSize') || '50', 10),
      100,
    );
    const cursor = c.req.query('cursor') || undefined;
    const filters = parseFilters(c);
    const sort = parseSort(c);

    try {
      const result = await studio.data.query({
        table: tableName,
        pageSize,
        cursor,
        filters: filters.length > 0 ? filters : undefined,
        sort: sort.length > 0 ? sort : undefined,
      });

      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  // ============================================
  // Monitoring API
  // ============================================

  /**
   * GET /api/stats
   * Get storage statistics
   */
  app.get('/api/stats', async (c) => {
    const stats = await studio.getStats();
    return c.json(stats);
  });

  /**
   * GET /api/requests
   * Get request entries
   */
  app.get('/api/requests', async (c) => {
    const options = parseQueryOptions(c);
    const requests = await studio.getRequests(options);
    return c.json(requests);
  });

  /**
   * GET /api/requests/:id
   * Get a single request by ID
   */
  app.get('/api/requests/:id', async (c) => {
    const request = await studio.getRequest(c.req.param('id'));
    if (!request) {
      return c.json({ error: 'Request not found' }, 404);
    }
    return c.json(request);
  });

  /**
   * GET /api/exceptions
   * Get exception entries
   */
  app.get('/api/exceptions', async (c) => {
    const options = parseQueryOptions(c);
    const exceptions = await studio.getExceptions(options);
    return c.json(exceptions);
  });

  /**
   * GET /api/exceptions/:id
   * Get a single exception by ID
   */
  app.get('/api/exceptions/:id', async (c) => {
    const exception = await studio.getException(c.req.param('id'));
    if (!exception) {
      return c.json({ error: 'Exception not found' }, 404);
    }
    return c.json(exception);
  });

  /**
   * GET /api/logs
   * Get log entries
   */
  app.get('/api/logs', async (c) => {
    const options = parseQueryOptions(c);
    const logs = await studio.getLogs(options);
    return c.json(logs);
  });

  // ============================================
  // Metrics API
  // ============================================

  /**
   * GET /api/metrics
   * Get aggregated request metrics
   */
  app.get('/api/metrics', (c) => {
    const options = parseMetricsQueryOptions(c);
    const metrics = studio.getMetrics(options);
    return c.json(metrics);
  });

  /**
   * GET /api/metrics/endpoints
   * Get metrics grouped by endpoint
   */
  app.get('/api/metrics/endpoints', (c) => {
    const options = parseMetricsQueryOptions(c);
    const endpoints = studio.getEndpointMetrics(options);
    return c.json(endpoints);
  });

  /**
   * GET /api/metrics/endpoint
   * Get detailed metrics for a specific endpoint
   */
  app.get('/api/metrics/endpoint', (c) => {
    const method = c.req.query('method');
    const path = c.req.query('path');

    if (!method || !path) {
      return c.json({ error: 'method and path are required' }, 400);
    }

    const options = parseMetricsQueryOptions(c);
    const details = studio.getEndpointDetails(method, path, options);

    if (!details) {
      return c.json({ error: 'Endpoint not found' }, 404);
    }

    return c.json(details);
  });

  /**
   * GET /api/metrics/status
   * Get HTTP status code distribution
   */
  app.get('/api/metrics/status', (c) => {
    const options = parseMetricsQueryOptions(c);
    const distribution = studio.getStatusDistribution(options);
    return c.json(distribution);
  });

  /**
   * DELETE /api/metrics
   * Reset all metrics
   */
  app.delete('/api/metrics', (c) => {
    studio.resetMetrics();
    return c.json({ success: true });
  });

  // ============================================
  // Static Assets & Dashboard UI
  // ============================================

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
    if (!html) {
      return c.json({
        message: 'Studio API is running',
        note: 'UI not available. Run "pnpm build:ui" first.',
        endpoints: {
          schema: '/api/schema',
          tables: '/api/tables',
          tableInfo: '/api/tables/:name',
          tableRows: '/api/tables/:name/rows',
          stats: '/api/stats',
          requests: '/api/requests',
          exceptions: '/api/exceptions',
          logs: '/api/logs',
          metrics: '/api/metrics',
        },
      });
    }
    return c.html(html);
  });

  // SPA fallback - serve index.html for client-side routing
  app.get('/*', (c) => {
    // Return 404 JSON for API routes
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'Not found' }, 404);
    }

    const html = getIndexHtml();
    if (!html) {
      return c.notFound();
    }
    return c.html(html);
  });

  return app;
}

// Re-export types
export type { DataBrowser };
