import { z } from 'zod';
import { router } from './router';

export const UserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  })
  .meta({ id: 'User' });
/**
 * Get all users
 */
export const getUsers = router
  .get('/users')
  .output(
    z.object({
      users: UserSchema.array(),
    }),
  )
  .handle(async () => {
    // Mock data for example
    return {
      users: [
        { id: '1', name: 'Alice', email: 'alice@example.com' },
        { id: '2', name: 'Bob', email: 'bob@example.com' },
      ],
    };
  });

/**
 * Create a new user
 */
export const createUser = router
  .post('/users')

  .body(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
  )
  .output(UserSchema)
  .event({
    type: 'user.created',
    payload: (r) => ({
      userId: r.id,
      email: r.email,
    }),
  })
  .handle(async ({ body, logger }) => {
    logger.info({ body }, 'Creating user');

    // Mock implementation
    return {
      id: Math.random().toString(36).substring(7),
      name: body.name,
      email: body.email,
      createdAt: new Date().toISOString(),
    };
  });

/**
 * Get user by ID
 */
export const getUser = router
  .get('/users/:id')
  .params(z.object({ id: z.string().min(1) }))
  .output(UserSchema)
  .handle(async ({ params }) => {
    // Mock data for example
    return {
      id: params.id,
      name: 'Sample User',
      email: 'user@example.com',
    };
  });
