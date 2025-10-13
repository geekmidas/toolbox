/**
 * Standalone App Example
 *
 * This demonstrates how to use the app without starting the server.
 * Useful for testing, custom server setups, or when you only need
 * the configured Hono app instance.
 */

import { createApp } from '../.gkm/server/app.js';

// Create the app without starting the server
const { app } = createApp();

// Now you can:
// 1. Use it in tests
// 2. Mount it in another app
// 3. Add custom middleware
// 4. Use it with a different server framework

// Example: Add custom middleware
app.use(async (c, next) => {
  console.log(`[${c.req.method}] ${c.req.url}`);
  await next();
});

// Example: Mount under a path prefix
import { Hono } from 'hono';

const mainApp = new Hono();
mainApp.route('/api/v1', app);

// Example: Use with custom server
const server = Bun.serve({
  port: 4000,
  fetch: mainApp.fetch,
});

console.log(`Custom server running on http://localhost:${server.port}`);
console.log(`API available at http://localhost:${server.port}/api/v1`);
