import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EndpointFactory } from '../EndpointFactory';

describe('EndpointFactory.authorizers', () => {
  it('should create factory with available authorizers', () => {
    const factory = new EndpointFactory().authorizers([
      'iam',
      'jwt-auth0',
      'custom',
    ] as const);

    const endpoint = factory
      .get('/users')
      .authorizer('iam')
      .handle(async () => ({ success: true }));

    expect(endpoint.authorizer).toEqual({ name: 'iam' });
  });

  it('should allow setting authorizer on individual endpoints', () => {
    const factory = new EndpointFactory().authorizers(['iam', 'jwt'] as const);

    const endpoint1 = factory
      .post('/admin/users')
      .authorizer('iam')
      .body(z.object({ name: z.string() }))
      .handle(async () => ({ success: true }));

    const endpoint2 = factory
      .get('/api/users')
      .authorizer('jwt')
      .handle(async () => ({ users: [] }));

    expect(endpoint1.authorizer).toEqual({ name: 'iam' });
    expect(endpoint2.authorizer).toEqual({ name: 'jwt' });
  });

  it('should throw error when using non-existent authorizer', () => {
    const factory = new EndpointFactory().authorizers(['iam', 'jwt'] as const);

    expect(() => {
      factory
        .post('/users')
        // @ts-expect-error - testing invalid authorizer
        .authorizer('invalid')
        .handle(async () => ({ success: true }));
    }).toThrow(
      'Authorizer "invalid" not found in available authorizers: iam, jwt',
    );
  });

  it('should allow endpoints without authorizers', () => {
    const factory = new EndpointFactory().authorizers(['iam', 'jwt'] as const);

    const endpoint = factory
      .get('/public')
      .handle(async () => ({ success: true }));

    expect(endpoint.authorizer).toBeUndefined();
  });

  it('should preserve authorizers when chaining factory methods', () => {
    const factory = new EndpointFactory()
      .authorizers(['iam', 'jwt', 'api-key'] as const)
      .route('/api/v1');

    const endpoint = factory
      .get('/protected')
      .authorizer('jwt')
      .handle(async () => ({ data: 'protected' }));

    expect(endpoint.authorizer).toEqual({ name: 'jwt' });
    expect(endpoint.route).toBe('/api/v1/protected');
  });

  it('should work with services and authorizers together', () => {
    const dbService = {
      serviceName: 'database' as const,
      register: async () => ({ query: async () => [] }),
    };

    const factory = new EndpointFactory()
      .services([dbService])
      .authorizers(['iam'] as const);

    const endpoint = factory
      .post('/users')
      .authorizer('iam')
      .body(z.object({ name: z.string() }))
      .handle(async ({ body, services }) => {
        await services.database.query();
        return { name: body.name };
      });

    expect(endpoint.authorizer).toEqual({ name: 'iam' });
  });

  it('should maintain type safety with authorizer names', () => {
    const factory = new EndpointFactory().authorizers(['iam', 'jwt'] as const);

    // This should compile with valid authorizer
    factory
      .get('/test1')
      .authorizer('iam')
      .handle(async () => ({}));

    // This should compile with valid authorizer
    factory
      .get('/test2')
      .authorizer('jwt')
      .handle(async () => ({}));

    // This should not compile with invalid authorizer (tested via TypeScript)
    // factory.get('/test3').authorizer('invalid').handle(async () => ({}));
  });

  it('should allow creating endpoints without calling authorizer() method', () => {
    const factory = new EndpointFactory().authorizers(['iam'] as const);

    const endpoint1 = factory
      .get('/public')
      .handle(async () => ({ public: true }));

    const endpoint2 = factory
      .get('/protected')
      .authorizer('iam')
      .handle(async () => ({ protected: true }));

    expect(endpoint1.authorizer).toBeUndefined();
    expect(endpoint2.authorizer).toEqual({ name: 'iam' });
  });

  it('should work with nested routes', () => {
    const apiFactory = new EndpointFactory()
      .authorizers(['iam', 'jwt'] as const)
      .route('/api');

    const v1Factory = apiFactory.route('/v1');
    const adminFactory = v1Factory.route('/admin');

    const endpoint = adminFactory
      .delete('/users/:id')
      .authorizer('iam')
      .params(z.object({ id: z.string() }))
      .handle(async () => ({ deleted: true }));

    expect(endpoint.route).toBe('/api/v1/admin/users/:id');
    expect(endpoint.authorizer).toEqual({ name: 'iam' });
  });

  it('should work with all HTTP methods', () => {
    const factory = new EndpointFactory().authorizers(['jwt'] as const);

    const getEndpoint = factory
      .get('/users')
      .authorizer('jwt')
      .handle(async () => ({ users: [] }));
    const postEndpoint = factory
      .post('/users')
      .authorizer('jwt')
      .handle(async () => ({ id: '1' }));
    const putEndpoint = factory
      .put('/users/:id')
      .authorizer('jwt')
      .handle(async () => ({ updated: true }));
    const patchEndpoint = factory
      .patch('/users/:id')
      .authorizer('jwt')
      .handle(async () => ({ patched: true }));
    const deleteEndpoint = factory
      .delete('/users/:id')
      .authorizer('jwt')
      .handle(async () => ({ deleted: true }));
    const optionsEndpoint = factory
      .options('/users')
      .authorizer('jwt')
      .handle(async () => ({}));

    expect(getEndpoint.authorizer).toEqual({ name: 'jwt' });
    expect(postEndpoint.authorizer).toEqual({ name: 'jwt' });
    expect(putEndpoint.authorizer).toEqual({ name: 'jwt' });
    expect(patchEndpoint.authorizer).toEqual({ name: 'jwt' });
    expect(deleteEndpoint.authorizer).toEqual({ name: 'jwt' });
    expect(optionsEndpoint.authorizer).toEqual({ name: 'jwt' });
  });

  it('should work with output schemas', () => {
    const factory = new EndpointFactory().authorizers(['iam'] as const);

    const outputSchema = z.object({
      id: z.string(),
      name: z.string(),
    });

    const endpoint = factory
      .get('/user')
      .authorizer('iam')
      .output(outputSchema)
      .handle(async () => ({
        id: '123',
        name: 'John Doe',
      }));

    expect(endpoint.authorizer).toEqual({ name: 'iam' });
    expect(endpoint.outputSchema).toBe(outputSchema);
  });

  it('should not throw error when no authorizers are configured', () => {
    const factory = new EndpointFactory();

    const endpoint = factory
      .get('/test')
      .handle(async () => ({ success: true }));

    expect(endpoint.authorizer).toBeUndefined();
  });

  it('should handle multiple authorizers with similar names', () => {
    const factory = new EndpointFactory().authorizers([
      'jwt-user',
      'jwt-admin',
      'jwt',
    ] as const);

    const endpoint1 = factory
      .get('/user')
      .authorizer('jwt-user')
      .handle(async () => ({}));
    const endpoint2 = factory
      .get('/admin')
      .authorizer('jwt-admin')
      .handle(async () => ({}));
    const endpoint3 = factory
      .get('/api')
      .authorizer('jwt')
      .handle(async () => ({}));

    expect(endpoint1.authorizer).toEqual({ name: 'jwt-user' });
    expect(endpoint2.authorizer).toEqual({ name: 'jwt-admin' });
    expect(endpoint3.authorizer).toEqual({ name: 'jwt' });
  });

  it('should support "none" to explicitly mark endpoint as having no authorizer', () => {
    const factory = new EndpointFactory().authorizers(['iam', 'jwt'] as const);

    const endpoint = factory
      .get('/public')
      .authorizer('none')
      .handle(async () => ({ public: true }));

    expect(endpoint.authorizer).toBeUndefined();
  });

  it('should allow "none" to override default authorizer from factory', () => {
    const factory = new EndpointFactory().authorizers(['iam', 'jwt'] as const);

    // In the future, if we add default authorizer support at factory level,
    // 'none' should override it
    const endpoint = factory
      .post('/public/signup')
      .authorizer('none')
      .body(z.object({ email: z.string() }))
      .handle(async () => ({ success: true }));

    expect(endpoint.authorizer).toBeUndefined();
  });

  it('should allow "none" even when no authorizers are configured', () => {
    const factory = new EndpointFactory();

    const endpoint = factory
      .get('/test')
      .authorizer('none')
      .handle(async () => ({ test: true }));

    expect(endpoint.authorizer).toBeUndefined();
  });

  it('should work with "none" in combination with other endpoint methods', () => {
    const factory = new EndpointFactory().authorizers(['iam'] as const);

    const endpoint = factory
      .post('/public/contact')
      .authorizer('none')
      .body(z.object({ message: z.string() }))
      .output(z.object({ sent: z.boolean() }))
      .description('Public contact form')
      .tags(['public', 'contact'])
      .handle(async () => ({ sent: true }));

    expect(endpoint.authorizer).toBeUndefined();
    expect(endpoint.description).toBe('Public contact form');
    expect(endpoint.tags).toEqual(['public', 'contact']);
  });
});
