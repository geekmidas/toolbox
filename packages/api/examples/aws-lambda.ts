import { AWSApiGatewayV1EndpointAdaptor } from '@geekmidas/api/aws-lambda';
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const envParser = new EnvironmentParser({});

// Example 1: Simple Lambda handler
const healthEndpoint = e
  .get('/health')
  .output(
    z.object({
      status: z.literal('ok'),
      region: z.string(),
      functionName: z.string(),
      timestamp: z.string(),
    }),
  )
  .handle(({ req }) => {
    // Access Lambda context from request headers
    const region = req.headers.get('x-aws-region') || 'unknown';
    const functionName = req.headers.get('x-aws-function-name') || 'unknown';

    return {
      status: 'ok' as const,
      region,
      functionName,
      timestamp: new Date().toISOString(),
    };
  });

const healthAdapter = new AWSApiGatewayV1EndpointAdaptor(
  healthEndpoint,
  envParser,
);
export const healthHandler = healthAdapter.handler;

// Example 2: Lambda with path parameters
const getUserEndpoint = e
  .get('/users/:userId')
  .params(
    z.object({
      userId: z.string().uuid(),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    }),
  )
  .handle(async ({ params }) => {
    // Simulate fetching user
    return {
      id: params.userId,
      name: 'Lambda User',
      email: 'user@lambda.com',
    };
  });

const getUserAdapter = new AWSApiGatewayV1EndpointAdaptor(
  getUserEndpoint,
  envParser,
);
export const getUserHandler = getUserAdapter.handler;

// Example 3: Lambda with query parameters and headers
const searchEndpoint = e
  .get('/search')
  .query(
    z.object({
      q: z.string().min(1),
      limit: z.string().transform(Number).default('10'),
      offset: z.string().transform(Number).default('0'),
    }),
  )
  .output(
    z.object({
      results: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          score: z.number(),
        }),
      ),
      total: z.number(),
      query: z.string(),
    }),
  )
  .handle(async ({ query, req, logger }) => {
    logger.info(
      {
        query: query.q,
        apiKey: req.headers.get('x-api-key')?.slice(0, 8) + '***',
      },
      'Search request',
    );

    return {
      results: [
        { id: '1', title: 'Result 1', score: 0.95 },
        { id: '2', title: 'Result 2', score: 0.87 },
      ],
      total: 2,
      query: query.q,
    };
  });

const searchAdapter = new AWSApiGatewayV1EndpointAdaptor(
  searchEndpoint,
  envParser,
);
export const searchHandler = searchAdapter.handler;

// Example 4: POST endpoint with body parsing
const createItemEndpoint = e
  .post('/items')
  .body(
    z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      price: z.number().positive(),
      tags: z.array(z.string()).default([]),
    }),
  )
  .output(
    z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      requestId: z.string(),
    }),
  )
  .handle(async ({ body, req }) => {
    const requestId = req.headers.get('x-amzn-request-id') || 'unknown';

    return {
      id: crypto.randomUUID(),
      name: body.name,
      createdAt: new Date().toISOString(),
      requestId,
    };
  });

const createItemAdapter = new AWSApiGatewayV1EndpointAdaptor(
  createItemEndpoint,
  envParser,
);
export const createItemHandler = createItemAdapter.handler;

// Example 5: Error handling in Lambda
const errorDemoEndpoint = e
  .get('/error-demo/:type')
  .params(
    z.object({
      type: z.enum(['notfound', 'validation', 'server']),
    }),
  )
  .handle(async ({ params }) => {
    switch (params.type) {
      case 'notfound':
        throw new NotFoundError('Resource not found');
      case 'validation':
        throw new UnprocessableEntityError('Validation failed', {
          errors: { field: 'Invalid value' },
        });
      case 'server':
        throw new Error('Unexpected server error');
    }
  });

const errorDemoAdapter = new AWSApiGatewayV1EndpointAdaptor(
  errorDemoEndpoint,
  envParser,
);
export const errorDemoHandler = errorDemoAdapter.handler;

// Example 6: Lambda with authentication
const protectedEndpoint = e
  .session(async ({ req }) => {
    const token = req.headers.get('authorization');

    if (!token || !token.startsWith('Bearer ')) {
      throw new ForbiddenError('Unauthorized access');
    }

    // In real app, validate JWT token
    // For Lambda, you might also use API Gateway authorizers
    return {
      userId: '123',
      role: 'user',
    };
  })
  .get('/protected-resource')
  .output(
    z.object({
      message: z.string(),
      userId: z.string(),
    }),
  )
  .handle(({ session }) => ({
    message: 'Access granted to protected resource',
    userId: session.userId,
  }));

const protectedAdapter = new AWSApiGatewayV1EndpointAdaptor(
  protectedEndpoint,
  envParser,
);
export const protectedHandler = protectedAdapter.handler;

// Example 7: Lambda with services
import { HermodService } from '@geekmidas/api/services';

interface DynamoDBClient {
  get(table: string, key: any): Promise<any>;
  put(table: string, item: any): Promise<void>;
  query(table: string, params: any): Promise<any[]>;
}

class DynamoDBService extends HermodService<DynamoDBClient> {
  static readonly serviceName = 'DynamoDB';

  async register() {
    // In real app, initialize AWS SDK DynamoDB client
    return {
      async get(table: string, key: any) {
        // Simulate DynamoDB get
        return { id: key.id, name: 'Item from DynamoDB' };
      },
      async put(table: string, item: any) {
        // Simulate DynamoDB put
        this.logger.info({ table, item }, 'Item saved to DynamoDB');
      },
      async query(table: string, params: any) {
        // Simulate DynamoDB query
        return [{ id: '1', name: 'Result 1' }];
      },
    };
  }
}

const dynamoEndpoint = e
  .services([DynamoDBService])
  .get('/items/:id')
  .params(z.object({ id: z.string() }))
  .handle(async ({ params, services }) => {
    const { DynamoDB } = services;

    const item = await DynamoDB.get('items-table', { id: params.id });

    if (!item) {
      throw new NotFoundError('Item not found');
    }

    return item;
  });

const dynamoAdapter = new AWSApiGatewayV1EndpointAdaptor(
  dynamoEndpoint,
  envParser,
);
export const dynamoHandler = dynamoAdapter.handler;

// Example 8: Lambda with custom middleware (using context)
const contextEndpoint = e
  .post('/context-demo')
  .handle(async ({ req, logger }) => {
    // Access Lambda event details from headers
    const stage = req.headers.get('x-api-gateway-stage') || 'unknown';
    const sourceIp = req.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    logger.info(
      {
        stage,
        sourceIp,
        userAgent,
      },
      'Request context',
    );

    return {
      message: 'Context received',
      context: {
        stage,
        sourceIp,
        userAgent,
      },
    };
  });

const contextAdapter = new AWSApiGatewayV1EndpointAdaptor(
  contextEndpoint,
  envParser,
);
export const contextHandler = contextAdapter.handler;

// Example 9: Binary response (e.g., images)
const imageEndpoint = e
  .get('/images/:id')
  .params(z.object({ id: z.string() }))
  .handle(async ({ params, req }) => {
    // In real app, fetch image from S3 or other storage
    const imageBuffer = Buffer.from('fake-image-data');

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  });

const imageAdapter = new AWSApiGatewayV1EndpointAdaptor(
  imageEndpoint,
  envParser,
);
export const imageHandler = imageAdapter.handler;

// Import error classes used in examples
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from '@geekmidas/api/errors';
import { EnvironmentParser } from '@geekmidas/envkit';
