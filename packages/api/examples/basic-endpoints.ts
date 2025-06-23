import { e } from '@geekmidas/api/server';
import { z } from 'zod';

// Example 1: Simple GET endpoint
export const healthCheck = e
  .get('/health')
  .output(
    z.object({
      status: z.literal('ok'),
      timestamp: z.string(),
      version: z.string(),
    }),
  )
  .handle(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }));

// Example 2: GET with parameters
export const getUser = e
  .get('/users/:id')
  .params(
    z.object({
      id: z.string().uuid(),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      createdAt: z.string(),
    }),
  )
  .handle(async ({ params, logger }) => {
    logger.info({ userId: params.id }, 'Fetching user');

    // Simulate database lookup
    return {
      id: params.id,
      name: 'John Doe',
      email: 'john@example.com',
      createdAt: new Date().toISOString(),
    };
  });

// Example 3: GET with query parameters
export const listUsers = e
  .get('/users')
  .query(
    z.object({
      page: z.string().transform(Number).default('1'),
      limit: z.string().transform(Number).default('10'),
      role: z.enum(['admin', 'user', 'guest']).optional(),
      search: z.string().optional(),
    }),
  )
  .output(
    z.object({
      users: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
          role: z.enum(['admin', 'user', 'guest']),
        }),
      ),
      pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        totalPages: z.number(),
      }),
    }),
  )
  .handle(async ({ query, logger }) => {
    logger.info({ query }, 'Listing users');

    // Simulate paginated response
    return {
      users: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'John Doe',
          email: 'john@example.com',
          role: 'user' as const,
        },
      ],
      pagination: {
        page: query.page,
        limit: query.limit,
        total: 100,
        totalPages: 10,
      },
    };
  });

// Example 4: POST with body validation
export const createUser = e
  .post('/users')
  .body(
    z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      password: z
        .string()
        .min(8)
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
          message: 'Password must contain uppercase, lowercase, and number',
        }),
      role: z.enum(['admin', 'user', 'guest']).default('user'),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.enum(['admin', 'user', 'guest']),
      createdAt: z.string(),
    }),
  )
  .handle(async ({ body, logger }) => {
    logger.info({ email: body.email }, 'Creating new user');

    // Simulate user creation
    const user = {
      id: crypto.randomUUID(),
      name: body.name,
      email: body.email,
      role: body.role,
      createdAt: new Date().toISOString(),
    };

    return user;
  });

// Example 5: PUT for updates
export const updateUser = e
  .put('/users/:id')
  .params(
    z.object({
      id: z.string().uuid(),
    }),
  )
  .body(
    z.object({
      name: z.string().min(2).max(100).optional(),
      email: z.string().email().optional(),
      role: z.enum(['admin', 'user', 'guest']).optional(),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.enum(['admin', 'user', 'guest']),
      updatedAt: z.string(),
    }),
  )
  .handle(async ({ params, body, logger }) => {
    logger.info({ userId: params.id, updates: body }, 'Updating user');

    // Simulate update
    return {
      id: params.id,
      name: body.name || 'John Doe',
      email: body.email || 'john@example.com',
      role: body.role || 'user',
      updatedAt: new Date().toISOString(),
    };
  });

// Example 6: DELETE endpoint
export const deleteUser = e
  .delete('/users/:id')
  .params(
    z.object({
      id: z.string().uuid(),
    }),
  )
  .output(
    z.object({
      success: z.boolean(),
      message: z.string(),
    }),
  )
  .handle(async ({ params, logger }) => {
    logger.info({ userId: params.id }, 'Deleting user');

    // Simulate deletion
    return {
      success: true,
      message: `User ${params.id} deleted successfully`,
    };
  });

// Example 7: Headers validation
export const secureEndpoint = e
  .post('/secure-action')
  .headers(
    z.object({
      'x-api-key': z.string().min(32),
      'x-request-id': z.string().uuid(),
      'content-type': z.literal('application/json'),
    }),
  )
  .body(
    z.object({
      action: z.string(),
      data: z.any(),
    }),
  )
  .output(
    z.object({
      success: z.boolean(),
      requestId: z.string(),
    }),
  )
  .handle(async ({ headers, body, logger }) => {
    logger.info(
      {
        requestId: headers['x-request-id'],
        action: body.action,
      },
      'Processing secure action',
    );

    return {
      success: true,
      requestId: headers['x-request-id'],
    };
  });

// Example 8: File upload simulation
export const uploadFile = e
  .post('/upload')
  .headers(
    z.object({
      'content-type': z.string().regex(/^multipart\/form-data/),
    }),
  )
  .body(
    z.object({
      filename: z.string(),
      mimeType: z.string(),
      size: z.number().max(10 * 1024 * 1024), // 10MB limit
      content: z.string(), // Base64 encoded
    }),
  )
  .output(
    z.object({
      id: z.string(),
      url: z.string().url(),
      size: z.number(),
      uploadedAt: z.string(),
    }),
  )
  .handle(async ({ body, logger }) => {
    logger.info({ filename: body.filename, size: body.size }, 'Uploading file');

    const fileId = crypto.randomUUID();

    return {
      id: fileId,
      url: `https://storage.example.com/files/${fileId}`,
      size: body.size,
      uploadedAt: new Date().toISOString(),
    };
  });

// Example 9: Complex nested data
export const createOrder = e
  .post('/orders')
  .body(
    z.object({
      customer: z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        name: z.string(),
      }),
      items: z
        .array(
          z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive(),
            price: z.number().positive(),
          }),
        )
        .min(1),
      shippingAddress: z.object({
        street: z.string(),
        city: z.string(),
        state: z.string().length(2),
        zipCode: z.string().regex(/^\d{5}$/),
        country: z.string().default('US'),
      }),
      paymentMethod: z.enum(['credit_card', 'paypal', 'bank_transfer']),
    }),
  )
  .output(
    z.object({
      orderId: z.string(),
      status: z.enum(['pending', 'processing', 'completed']),
      total: z.number(),
      createdAt: z.string(),
    }),
  )
  .handle(async ({ body, logger }) => {
    logger.info(
      {
        customerId: body.customer.id,
        itemCount: body.items.length,
      },
      'Creating order',
    );

    const total = body.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    return {
      orderId: crypto.randomUUID(),
      status: 'pending' as const,
      total,
      createdAt: new Date().toISOString(),
    };
  });

// Example 10: Optional fields and defaults
export const searchProducts = e
  .get('/products/search')
  .query(
    z.object({
      q: z.string().min(1),
      category: z.string().optional(),
      minPrice: z.string().transform(Number).optional(),
      maxPrice: z.string().transform(Number).optional(),
      inStock: z
        .string()
        .transform((v) => v === 'true')
        .default('true'),
      sortBy: z.enum(['price', 'name', 'rating']).default('name'),
      order: z.enum(['asc', 'desc']).default('asc'),
    }),
  )
  .output(
    z.object({
      products: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          price: z.number(),
          category: z.string(),
          inStock: z.boolean(),
          rating: z.number().min(0).max(5),
        }),
      ),
      query: z.object({
        term: z.string(),
        filters: z.record(z.any()),
      }),
    }),
  )
  .handle(async ({ query, logger }) => {
    logger.info({ searchTerm: query.q }, 'Searching products');

    return {
      products: [
        {
          id: '1',
          name: 'Sample Product',
          price: 99.99,
          category: query.category || 'general',
          inStock: query.inStock,
          rating: 4.5,
        },
      ],
      query: {
        term: query.q,
        filters: {
          category: query.category,
          priceRange: [query.minPrice, query.maxPrice],
          inStock: query.inStock,
        },
      },
    };
  });
