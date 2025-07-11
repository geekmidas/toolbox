import { e } from '@geekmidas/api/server';
import { z } from 'zod/v4';

export const healthCheck = e
  .get('/health')
  .output(
    z.object({
      status: z.literal('ok'),
      timestamp: z.string(),
    }),
  )
  .handle(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  }));
