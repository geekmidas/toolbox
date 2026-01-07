import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

/**
 * Minimal-tier public endpoints
 *
 * These endpoints have no auth, no services, no database - just pure request/response.
 * They generate near-raw-Hono performance handlers at build time.
 */

/**
 * Simple ping endpoint - returns pong
 */
export const ping = e
  .get('/ping')
  .output(z.object({ message: z.literal('pong') }))
  .handle(async () => {
    return { message: 'pong' as const };
  });

/**
 * Version endpoint - returns API version info
 */
export const version = e
  .get('/version')
  .output(
    z.object({
      version: z.string(),
      build: z.string(),
      node: z.string(),
    }),
  )
  .handle(async () => {
    return {
      version: '1.0.0',
      build: process.env.BUILD_ID || 'development',
      node: process.version,
    };
  });

/**
 * Time endpoint - returns current server time
 */
export const time = e
  .get('/time')
  .output(
    z.object({
      iso: z.string(),
      unix: z.number(),
      timezone: z.string(),
    }),
  )
  .handle(async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      unix: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  });

/**
 * Echo endpoint - echoes back query parameters
 */
export const echo = e
  .get('/echo')
  .query(z.record(z.string()))
  .output(z.object({ echo: z.record(z.string()) }))
  .handle(async ({ query }) => {
    return { echo: query };
  });
