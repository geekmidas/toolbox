import { Hono } from 'hono';
import type { Context } from 'hono';
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
 * Only requires the data browser - monitoring routes are separate.
 */
export interface StudioLike {
  data: DataBrowser<unknown>;
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
      const [, column, operator] = match;
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

  return sortParam.split(',').map((part) => {
    const [column, dir] = part.split(':');
    return {
      column,
      direction: dir === 'desc' ? Direction.Desc : Direction.Asc,
    };
  });
}

/**
 * Create Hono app with Studio API routes and dashboard UI.
 */
export function createStudioApp(studio: StudioLike): Hono {
  const app = new Hono();

  // ============================================
  // Schema API
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
   *
   * Query parameters:
   * - pageSize: number (default: 50, max: 100)
   * - cursor: string (pagination cursor)
   * - filter[column][operator]=value (e.g., filter[status][eq]=active)
   * - sort=column:direction (e.g., sort=created_at:desc)
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
        },
      });
    }
    return c.html(html);
  });

  // SPA fallback - serve index.html for client-side routing
  app.get('/*', (c) => {
    // Skip API routes
    if (c.req.path.startsWith('/api/')) {
      return c.notFound();
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
export type { StudioLike, DataBrowser };
