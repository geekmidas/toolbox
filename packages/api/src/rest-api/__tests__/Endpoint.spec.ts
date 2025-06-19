import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { Endpoint } from '../Endpoint';

describe('Endpoint', () => {
  it('Endpoint.toJSONSchema', async () => {
    const getUsers = Endpoint.get('/users')
      .query(z.object({ q: z.string().min(2).max(100) }))
      .description('Get users')
      .output(
        z.object({
          name: z.string(),
        }),
      )
      .handle(({ services }) => ({
        name: '',
      }));

    const schema = await getUsers.toOpenAPI();

    expect(schema).toHaveProperty('/users');
    expect(schema['/users']).toHaveProperty('get');
  });

  it('Endpoint.toJSONSchema PUT', async () => {
    const getUsers = Endpoint.put('/users')
      .body(z.object({ name: z.string().min(2).max(100) }))
      .description('Get users')
      .output(
        z.object({
          name: z.string(),
        }),
      )
      .handle(({ services }) => ({
        name: '',
      }));

    const schema = await getUsers.toOpenAPI();

    expect(schema).toHaveProperty('/users');
    expect(schema['/users']).toHaveProperty('put');
  });
});
