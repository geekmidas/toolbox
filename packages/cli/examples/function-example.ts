import { f } from '@geekmidas/api/function';
import { z } from 'zod';

/**
 * Example function that processes an order
 */
export const processOrder = f
  .input(
    z.object({
      orderId: z.string(),
      items: z.array(
        z.object({
          id: z.string(),
          quantity: z.number().int().positive(),
        }),
      ),
    }),
  )
  .output(
    z.object({
      orderId: z.string(),
      status: z.enum(['processing', 'completed', 'failed']),
      processedAt: z.string().datetime(),
    }),
  )
  .timeout(300000) // 5 minutes
  .handle(async ({ input, services, logger }) => {
    logger.info(`Processing order ${input.orderId}`);

    // Process order logic here
    for (const item of input.items) {
      logger.info(`Processing item ${item.id}, quantity: ${item.quantity}`);
    }

    return {
      orderId: input.orderId,
      status: 'completed' as const,
      processedAt: new Date().toISOString(),
    };
  });