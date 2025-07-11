import { e } from '@geekmidas/api/server';
import { z } from 'zod/v4';

export const getUser = e
  .get('/users/:id')
  .params(z.object({ id: z.uuid() }))
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.email(),
    }),
  )
  .handle(async ({ params }) => {
    return {
      id: params.id,
      name: 'Test User',
      email: 'test@example.com',
    };
  });

export const createUser = e
  .post('/users')
  .body(
    z.object({
      name: z.string(),
      email: z.email(),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    }),
  )
  .handle(async ({ body }) => {
    return {
      id: crypto.randomUUID(),
      ...body,
    };
  });

export const getUsers = e
  .get('/users')
  .output(
    z
      .object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })
      .array(),
  )
  .handle(async ({}) => {
    return [];
  });
