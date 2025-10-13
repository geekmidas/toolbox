/**
 * Example Application
 *
 * This demonstrates how to use the generated server application
 * with the new createApp API.
 */

// First, run the build command to generate the server files:
// pnpm run build
//
// Then start the server with:
// pnpm run dev

import { serve } from '@hono/node-server';
import { swaggerUI } from '@hono/swagger-ui';
import { createApp } from '../.gkm/server/app.js';
import logger from './config/logger.js';

const { app, start } = createApp();

app.get('/ui', swaggerUI({ url: '/docs' }));

// Start the server with Bun runtime
await start({
  port: 3001,
  serve: (app, port) => {
    serve(
      {
        port,
        fetch: app.fetch,
      },
      ({ port }) => {
        logger.info(`🚀 Server started on http://localhost:${port}`);
        logger.info(
          `📚 OpenAPI docs available at http://localhost:${port}/docs`,
        );
      },
    );
  },
});

// To use with Node.js instead, install @hono/node-server and use:
//
// import { serve } from '@hono/node-server';
//
// await start({
//   port: 3000,
//   serve: (app, port) => {
//     serve({ fetch: app.fetch, port });
//     console.log(`🚀 Server started on http://localhost:${port}`);
//   }
// });
