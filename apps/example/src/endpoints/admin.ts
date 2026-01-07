import { z } from 'zod';
import { router } from './router';

/**
 * Full-tier admin endpoints
 *
 * These endpoints have declarative audits which triggers full-tier
 * code generation with HonoEndpoint.addRoutes (transaction wrapping).
 */

const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  deletedAt: z.string().optional(),
});

type UserResponse = z.infer<typeof userResponseSchema>;

/**
 * Delete user endpoint - with declarative audit logging
 *
 * Uses .audit() to automatically log the deletion after success.
 * This triggers full-tier generation with transaction wrapping.
 */
export const deleteUser = router
  .delete('/admin/users/:id')
  .params(z.object({ id: z.string() }))
  .output(userResponseSchema)
  .audit([
    {
      type: 'user.deleted',
      payload: (response: UserResponse) => ({
        userId: response.id,
      }),
      entityId: (response: UserResponse) => response.id,
      table: 'users',
    },
  ])
  .handle(async ({ params, logger }) => {
    logger.info({ userId: params.id }, 'Deleting user');

    // Simulated deletion
    return {
      id: params.id,
      email: `deleted-${params.id}@example.com`,
      role: 'user',
      deletedAt: new Date().toISOString(),
    };
  });

/**
 * Promote user to admin - with multiple audit events
 */
export const promoteUser = router
  .post('/admin/users/:id/promote')
  .params(z.object({ id: z.string() }))
  .body(z.object({ role: z.enum(['admin', 'moderator', 'user']) }))
  .output(userResponseSchema)
  .audit([
    {
      type: 'user.updated',
      payload: (response: UserResponse) => ({
        userId: response.id,
        changes: ['role'],
      }),
      entityId: (response: UserResponse) => response.id,
      table: 'users',
    },
  ])
  .handle(async ({ params, body, logger }) => {
    logger.info({ userId: params.id, newRole: body.role }, 'Promoting user');

    return {
      id: params.id,
      email: `user-${params.id}@example.com`,
      role: body.role,
    };
  });
