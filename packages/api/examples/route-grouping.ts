import { ForbiddenError, UnauthorizedError } from '@geekmidas/api/errors';
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

// Example 1: Basic route grouping
const api = e.route('/api');
const v1 = api.route('/v1');
const v2 = api.route('/v2');

// V1 endpoints
const v1Users = v1.route('/users');

export const v1GetUsers = v1Users
  .get('/')
  .output(
    z.object({
      users: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
      version: z.literal('v1'),
    }),
  )
  .handle(() => ({
    users: [{ id: '1', name: 'User 1' }],
    version: 'v1' as const,
  }));

export const v1GetUser = v1Users
  .get('/:id')
  .params(z.object({ id: z.string() }))
  .handle(({ params }) => ({
    id: params.id,
    name: 'User from V1',
  }));

// V2 endpoints with enhanced features
const v2Users = v2.route('/users');

export const v2GetUsers = v2Users
  .get('/')
  .query(
    z.object({
      page: z.string().transform(Number).default('1'),
      limit: z.string().transform(Number).default('10'),
    }),
  )
  .output(
    z.object({
      users: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
        }),
      ),
      pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
      }),
      version: z.literal('v2'),
    }),
  )
  .handle(({ query }) => ({
    users: [
      {
        id: '1',
        name: 'User 1',
        email: 'user1@example.com',
      },
    ],
    pagination: {
      page: query.page,
      limit: query.limit,
      total: 100,
    },
    version: 'v2' as const,
  }));

// Example 2: Nested route groups
const admin = api.route('/admin');
const adminUsers = admin.route('/users');
const adminReports = admin.route('/reports');

export const adminGetUsers = adminUsers.get('/').handle(() => ({
  users: [{ id: '1', name: 'Admin User', role: 'admin' }],
}));

export const adminDeleteUser = adminUsers
  .delete('/:id')
  .params(z.object({ id: z.string() }))
  .handle(({ params }) => ({
    deleted: true,
    userId: params.id,
  }));

export const adminGetReports = adminReports
  .get('/')
  .query(
    z.object({
      type: z.enum(['users', 'sales', 'analytics']),
      startDate: z.string(),
      endDate: z.string(),
    }),
  )
  .handle(({ query }) => ({
    report: `${query.type} report from ${query.startDate} to ${query.endDate}`,
    data: [],
  }));

// Example 3: Authorization at route group level
const authenticatedApi = e.session(async ({ req }) => {
  const token = req.headers.get('authorization');
  if (!token) {
    throw new UnauthorizedError('Authentication token required');
  }

  // Simulate token validation
  return { userId: '123', role: 'user' };
});

const userApi = authenticatedApi.route('/user');

export const getUserProfile = userApi.get('/profile').handle(({ session }) => ({
  userId: session.userId,
  role: session.role,
  profile: { name: 'John Doe', email: 'john@example.com' },
}));

export const updateUserProfile = userApi
  .put('/profile')
  .body(
    z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
    }),
  )
  .handle(({ session, body }) => ({
    userId: session.userId,
    updated: true,
    changes: body,
  }));

// Example 4: Multiple middleware layers
const protectedApi = e
  .session(async ({ req }) => {
    // Load session
    const sessionId = req.headers.get('x-session-id');
    if (!sessionId) return null;

    return {
      userId: '123',
      organizationId: 'org-456',
    };
  })
  .authorize(async ({ session }) => {
    if (!session) return false;
    return true;
  });

const orgApi = protectedApi.route('/organizations/:orgId');

export const getOrganization = orgApi
  .get('/')
  .params(z.object({ orgId: z.string() }))
  .handle(({ params, session }) => {
    if (session?.organizationId !== params.orgId) {
      throw new ForbiddenError('Access denied to this organization');
    }

    return {
      id: params.orgId,
      name: 'My Organization',
      members: 42,
    };
  });

// Example 5: Resource-based routing
const resources = api.route('/resources');

// Generic resource CRUD operations
function createResourceEndpoints(resourceName: string) {
  const resource = resources.route(`/${resourceName}`);

  const list = resource
    .get('/')
    .query(
      z.object({
        filter: z.string().optional(),
        sort: z.string().optional(),
      }),
    )
    .handle(({ query }) => ({
      resource: resourceName,
      items: [],
      filter: query.filter,
      sort: query.sort,
    }));

  const get = resource
    .get('/:id')
    .params(z.object({ id: z.string() }))
    .handle(({ params }) => ({
      resource: resourceName,
      id: params.id,
      data: {},
    }));

  const create = resource
    .post('/')
    .body(z.object({ data: z.any() }))
    .handle(({ body }) => ({
      resource: resourceName,
      created: true,
      data: body.data,
    }));

  const update = resource
    .put('/:id')
    .params(z.object({ id: z.string() }))
    .body(z.object({ data: z.any() }))
    .handle(({ params, body }) => ({
      resource: resourceName,
      id: params.id,
      updated: true,
      data: body.data,
    }));

  const remove = resource
    .delete('/:id')
    .params(z.object({ id: z.string() }))
    .handle(({ params }) => ({
      resource: resourceName,
      id: params.id,
      deleted: true,
    }));

  return { list, get, create, update, remove };
}

// Create endpoints for different resources
export const productsEndpoints = createResourceEndpoints('products');
export const ordersEndpoints = createResourceEndpoints('orders');
export const customersEndpoints = createResourceEndpoints('customers');

// Example 6: Microservice-style routing
const services = e.route('/services');

// User service
const userService = services.route('/user-service');
const userServiceV1 = userService.route('/v1');

export const userServiceHealth = userService
  .get('/health')
  .handle(() => ({ service: 'user-service', status: 'healthy' }));

export const userServiceGetUser = userServiceV1
  .get('/users/:id')
  .params(z.object({ id: z.string() }))
  .handle(({ params }) => ({
    service: 'user-service',
    version: 'v1',
    user: { id: params.id },
  }));

// Order service
const orderService = services.route('/order-service');
const orderServiceV1 = orderService.route('/v1');

export const orderServiceHealth = orderService
  .get('/health')
  .handle(() => ({ service: 'order-service', status: 'healthy' }));

export const orderServiceGetOrder = orderServiceV1
  .get('/orders/:id')
  .params(z.object({ id: z.string() }))
  .handle(({ params }) => ({
    service: 'order-service',
    version: 'v1',
    order: { id: params.id },
  }));

// Example 7: Feature flag based routing
const features = e.route('/features');

// Beta features (only for beta users)
const betaFeatures = features
  .session(async ({ req }) => {
    const userId = req.headers.get('x-user-id');
    const betaUsers = ['user-123', 'user-456'];

    if (!userId || !betaUsers.includes(userId)) {
      throw new ForbiddenError('Beta access required');
    }

    return { userId, beta: true };
  })
  .route('/beta');

export const betaFeature1 = betaFeatures.get('/feature1').handle(() => ({
  feature: 'beta-feature-1',
  status: 'active',
}));

// Example 8: Tenant-based routing
const tenantApi = e
  .session(async ({ req }) => {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) {
      throw new UnauthorizedError('Tenant ID required');
    }

    return { tenantId };
  })
  .route('/tenants/:tenantId');

export const getTenantData = tenantApi
  .get('/data')
  .params(z.object({ tenantId: z.string() }))
  .handle(({ params, session }) => {
    if (session?.tenantId !== params.tenantId) {
      throw new ForbiddenError('Access denied to this tenant');
    }

    return {
      tenantId: params.tenantId,
      data: { settings: {}, users: [] },
    };
  });

// Example 9: Public and private route separation
const publicApi = api.route('/public');
const privateApi = api
  .authorize(async ({ req }) => {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey || apiKey !== 'valid-key') {
      return false;
    }
    return true;
  })
  .route('/private');

export const publicStatus = publicApi.get('/status').handle(() => ({
  status: 'ok',
  public: true,
}));

export const privateData = privateApi.get('/data').handle(() => ({
  data: 'This is private data',
  public: false,
}));

// Example 10: Complex nested routing structure
const app = e.route('/app');
const appV1 = app.route('/v1');
const appV1Auth = appV1.authorize(async () => true).route('/auth');

const appV1Dashboard = appV1Auth.route('/dashboard');
const appV1Settings = appV1Auth.route('/settings');

export const getDashboardStats = appV1Dashboard
  .get('/stats')
  .query(
    z.object({
      period: z.enum(['day', 'week', 'month', 'year']).default('month'),
    }),
  )
  .handle(({ query }) => ({
    period: query.period,
    stats: {
      users: 1000,
      revenue: 50000,
      growth: 12.5,
    },
  }));

export const getSettings = appV1Settings.get('/').handle(() => ({
  theme: 'dark',
  notifications: true,
  language: 'en',
}));

export const updateSettings = appV1Settings
  .patch('/')
  .body(
    z.object({
      theme: z.enum(['light', 'dark']).optional(),
      notifications: z.boolean().optional(),
      language: z.string().optional(),
    }),
  )
  .handle(({ body }) => ({
    updated: true,
    settings: body,
  }));

// Example: Route documentation
export const routeMap = {
  v1: {
    users: ['/api/v1/users', '/api/v1/users/:id'],
    admin: ['/api/admin/users', '/api/admin/reports'],
  },
  v2: {
    users: ['/api/v2/users'],
  },
  services: {
    user: [
      '/services/user-service/health',
      '/services/user-service/v1/users/:id',
    ],
    order: [
      '/services/order-service/health',
      '/services/order-service/v1/orders/:id',
    ],
  },
};
