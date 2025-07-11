import { e } from '@geekmidas/api/server';
import { z } from 'zod';

export const getUser = e
  .get('/users/:id')
  .params(z.object({ id: z.string().uuid() }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email()
  }))
  .handle(async ({ params }) => {
    return {
      id: params.id,
      name: 'Test User',
      email: 'test@example.com'
    };
  });

export const createUser = e
  .post('/users')
  .body(z.object({
    name: z.string(),
    email: z.string().email()
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string()
  }))
  .handle(async ({ body }) => {
    return {
      id: crypto.randomUUID(),
      ...body
    };
  });