import { EnvironmentParser } from '@geekmidas/envkit';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { ConsoleLogger } from '../../logger';
import { HermodService } from '../../services';
import { e } from '../Endpoint';
import { HonoEndpointAdaptor } from '../HonoEndpointAdaptor';

const E = e.services([]);
const envParser = new EnvironmentParser({});

describe('HonoEndpointAdaptor', () => {
  it('Should parse query params', async () => {
    const query = z.object({ q: z.string().min(2).max(100) });
    const getUsers = E.get('/echo')
      .query(query)
      .description('Get users')
      .output(query)
      .handle(({ query }) => query);

    const h = new HonoEndpointAdaptor({
      endpoints: [getUsers],
      envParser,
    });

    const app = await h.register();

    const response = await app.request('/echo?q=test');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ q: 'test' });
  });

  it('Should load session', async () => {
    const query = z.object({ userId: z.string() });
    const s = { userId: '123' };
    const getUsers = E.session(() => s)
      .get('/echo')
      .description('Get users')
      .output(query)
      .handle(({ session }) => session);

    const h = new HonoEndpointAdaptor({
      endpoints: [getUsers],
      envParser,
    });

    const app = await h.register();

    const response = await app.request('/echo');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(s);
  });

  it('Should load services', async () => {
    const query = z.object({ userId: z.string() }).array();
    class UserService extends HermodService<{
      get: () => Promise<{ userId: string }[]>;
    }> {
      static readonly serviceName = 'user';
      async register() {
        return {
          get: async () => [{ userId: '123' }],
        };
      }
    }

    const getUsers = E.services([UserService])
      .get('/users')
      .description('Get users')
      .output(query)
      .handle(({ services }) => services.user.get());

    const h = new HonoEndpointAdaptor({
      endpoints: [getUsers],
      envParser: new EnvironmentParser({}),
    });

    const app = await h.register();

    const response = await app.request('/users');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([{ userId: '123' }]);
  });

  it('HonoEndpointAdaptor.fromRoutes: Should resolve app from routes', async () => {
    const root = __dirname;
    const app = await HonoEndpointAdaptor.fromRoutes(
      ['data/*.ts'],
      envParser,
      new Hono(),
      new ConsoleLogger(),
      root,
    );

    const response = await app.request('/users');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });
});
