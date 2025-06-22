import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { HermodService } from '../../services';
import { e } from '../Endpoint';

class TestService extends HermodService<{
  name: string;
}> {
  static readonly serviceName = 'TestService';
  register() {
    return Promise.resolve({
      name: 'TestService',
    });
  }
}

class TestService2 extends HermodService<{}> {
  static readonly serviceName = 'TestService2';
  register(): Promise<{}> {
    return Promise.resolve({});
  }
}

const E = e.services([TestService]);

describe('Endpoint', () => {
  it('Endpoint.toJSONSchema', async () => {
    const getUsers = E.get('/users')
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
    const updateUsers = E.put('/users')
      .body(z.object({ name: z.string().min(2).max(100) }))
      .description('Get users')
      .output(
        z.object({
          name: z.string(),
        }),
      )
      .handle(({ services }) => {
        return {
          name: '',
        };
      });

    const schema = await updateUsers.toOpenAPI();

    expect(schema).toHaveProperty('/users');
    expect(schema['/users']).toHaveProperty('put');
  });

  it('Should have services', async () => {
    const createUser = E.post('/users')
      .body(z.object({ name: z.string().min(2).max(100) }))
      .services([TestService2])
      .description('Get users')
      .output(
        z.object({
          name: z.string(),
        }),
      )
      .handle(({ services }) => {
        return {
          name: '',
        };
      });

    expect(createUser.services).toHaveLength(2);
  });
});
