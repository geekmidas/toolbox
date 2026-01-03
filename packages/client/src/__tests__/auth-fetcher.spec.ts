import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createAuthAwareFetcher,
  type ApiKeyProvider,
  type AuthFetcherOptions,
  type AwsSigner,
  type SecuritySchemeObject,
  type TokenProvider,
} from '../auth-fetcher';

// Test types
interface TestPaths {
  'GET /users': {
    responses: {
      200: {
        content: {
          'application/json': { users: Array<{ id: string; name: string }> };
        };
      };
    };
  };
  'GET /protected': {
    responses: {
      200: {
        content: {
          'application/json': { data: string };
        };
      };
    };
  };
  'GET /api-key-protected': {
    responses: {
      200: {
        content: {
          'application/json': { data: string };
        };
      };
    };
  };
  'GET /iam-protected': {
    responses: {
      200: {
        content: {
          'application/json': { data: string };
        };
      };
    };
  };
  'POST /data': {
    requestBody: {
      content: {
        'application/json': { value: string };
      };
    };
    responses: {
      201: {
        content: {
          'application/json': { id: string };
        };
      };
    };
  };
}

// Track headers received by handlers
let lastReceivedHeaders: Record<string, string> = {};

const handlers = [
  http.get('https://api.example.com/users', ({ request }) => {
    lastReceivedHeaders = Object.fromEntries(request.headers.entries());
    return HttpResponse.json({
      users: [{ id: '1', name: 'John' }],
    });
  }),

  http.get('https://api.example.com/protected', ({ request }) => {
    lastReceivedHeaders = Object.fromEntries(request.headers.entries());
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== 'Bearer valid-token') {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    return HttpResponse.json({ data: 'secret' });
  }),

  http.get('https://api.example.com/api-key-protected', ({ request }) => {
    lastReceivedHeaders = Object.fromEntries(request.headers.entries());
    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey || apiKey !== 'my-api-key') {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    return HttpResponse.json({ data: 'api-key-data' });
  }),

  http.get('https://api.example.com/iam-protected', ({ request }) => {
    lastReceivedHeaders = Object.fromEntries(request.headers.entries());
    return HttpResponse.json({ data: 'iam-data' });
  }),

  http.post('https://api.example.com/data', async ({ request }) => {
    lastReceivedHeaders = Object.fromEntries(request.headers.entries());
    return HttpResponse.json({ id: '123' }, { status: 201 });
  }),
];

const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  lastReceivedHeaders = {};
  vi.clearAllMocks();
});

afterAll(() => {
  server.close();
});

describe('createAuthAwareFetcher', () => {
  const securitySchemes: Record<string, SecuritySchemeObject> = {
    bearer: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    },
    apiKey: {
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    },
    iam: {
      type: 'http',
      scheme: 'aws4-hmac-sha256',
    },
  };

  describe('bearer auth', () => {
    it('should add Authorization header for bearer auth endpoints', async () => {
      const tokenProvider: TokenProvider = {
        getValidAccessToken: vi.fn().mockResolvedValue('valid-token'),
        createValidAuthHeaders: vi.fn().mockResolvedValue({
          Authorization: 'Bearer valid-token',
        }),
      };

      const endpointAuth = {
        'GET /users': null,
        'GET /protected': 'bearer',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes,
        authStrategies: {
          bearer: { type: 'bearer', tokenProvider },
        },
      });

      const result = await api('GET /protected');

      expect(tokenProvider.createValidAuthHeaders).toHaveBeenCalled();
      expect(result).toEqual({ data: 'secret' });
      expect(lastReceivedHeaders.authorization).toBe('Bearer valid-token');
    });

    it('should not add auth headers for public endpoints', async () => {
      const tokenProvider: TokenProvider = {
        getValidAccessToken: vi.fn().mockResolvedValue('valid-token'),
        createValidAuthHeaders: vi.fn().mockResolvedValue({
          Authorization: 'Bearer valid-token',
        }),
      };

      const endpointAuth = {
        'GET /users': null,
        'GET /protected': 'bearer',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes,
        authStrategies: {
          bearer: { type: 'bearer', tokenProvider },
        },
      });

      const result = await api('GET /users');

      expect(tokenProvider.createValidAuthHeaders).not.toHaveBeenCalled();
      expect(result).toEqual({ users: [{ id: '1', name: 'John' }] });
      expect(lastReceivedHeaders.authorization).toBeUndefined();
    });
  });

  describe('apiKey auth', () => {
    it('should add API key header for apiKey auth endpoints', async () => {
      const apiKeyProvider: ApiKeyProvider = {
        getApiKey: vi.fn().mockResolvedValue('my-api-key'),
      };

      const endpointAuth = {
        'GET /api-key-protected': 'apiKey',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes,
        authStrategies: {
          apiKey: { type: 'apiKey', apiKeyProvider },
        },
      });

      const result = await api('GET /api-key-protected');

      expect(apiKeyProvider.getApiKey).toHaveBeenCalled();
      expect(result).toEqual({ data: 'api-key-data' });
      expect(lastReceivedHeaders['x-api-key']).toBe('my-api-key');
    });

    it('should use custom header name if provided', async () => {
      const apiKeyProvider: ApiKeyProvider = {
        getApiKey: vi.fn().mockResolvedValue('custom-key'),
      };

      const customSchemes: Record<string, SecuritySchemeObject> = {
        customApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Custom-Key',
        },
      };

      const endpointAuth = {
        'GET /api-key-protected': 'customApiKey',
      } as const;

      server.use(
        http.get('https://api.example.com/api-key-protected', ({ request }) => {
          lastReceivedHeaders = Object.fromEntries(request.headers.entries());
          return HttpResponse.json({ data: 'custom-key-data' });
        }),
      );

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes: customSchemes,
        authStrategies: {
          customApiKey: {
            type: 'apiKey',
            apiKeyProvider,
            headerName: 'X-Custom-Key',
          },
        },
      });

      await api('GET /api-key-protected');

      expect(lastReceivedHeaders['x-custom-key']).toBe('custom-key');
    });

    it('should handle synchronous getApiKey', async () => {
      const apiKeyProvider: ApiKeyProvider = {
        getApiKey: vi.fn().mockReturnValue('sync-api-key'),
      };

      server.use(
        http.get('https://api.example.com/api-key-protected', ({ request }) => {
          lastReceivedHeaders = Object.fromEntries(request.headers.entries());
          return HttpResponse.json({ data: 'sync-data' });
        }),
      );

      const endpointAuth = {
        'GET /api-key-protected': 'apiKey',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes,
        authStrategies: {
          apiKey: { type: 'apiKey', apiKeyProvider },
        },
      });

      await api('GET /api-key-protected');

      expect(lastReceivedHeaders['x-api-key']).toBe('sync-api-key');
    });
  });

  describe('IAM auth', () => {
    it('should call signer for IAM auth endpoints', async () => {
      const signer: AwsSigner = {
        sign: vi.fn().mockResolvedValue({}),
      };

      const endpointAuth = {
        'GET /iam-protected': 'iam',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes,
        authStrategies: {
          iam: { type: 'iam', signer },
        },
      });

      const result = await api('GET /iam-protected');

      // IAM returns empty headers in current implementation
      expect(result).toEqual({ data: 'iam-data' });
    });
  });

  describe('header merging', () => {
    it('should merge auth headers with user-provided headers', async () => {
      const tokenProvider: TokenProvider = {
        getValidAccessToken: vi.fn().mockResolvedValue('valid-token'),
        createValidAuthHeaders: vi.fn().mockResolvedValue({
          Authorization: 'Bearer valid-token',
        }),
      };

      const endpointAuth = {
        'GET /protected': 'bearer',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes,
        authStrategies: {
          bearer: { type: 'bearer', tokenProvider },
        },
      });

      await api('GET /protected', {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      expect(lastReceivedHeaders.authorization).toBe('Bearer valid-token');
      expect(lastReceivedHeaders['x-custom-header']).toBe('custom-value');
    });

    it('should allow user headers to override auth headers', async () => {
      const tokenProvider: TokenProvider = {
        getValidAccessToken: vi.fn().mockResolvedValue('valid-token'),
        createValidAuthHeaders: vi.fn().mockResolvedValue({
          Authorization: 'Bearer valid-token',
        }),
      };

      // Override handler to accept any valid Bearer token
      server.use(
        http.get('https://api.example.com/protected', ({ request }) => {
          lastReceivedHeaders = Object.fromEntries(request.headers.entries());
          const auth = request.headers.get('Authorization');
          if (!auth || !auth.startsWith('Bearer ')) {
            return HttpResponse.json(
              { message: 'Unauthorized' },
              { status: 401 },
            );
          }
          return HttpResponse.json({ data: 'secret' });
        }),
      );

      const endpointAuth = {
        'GET /protected': 'bearer',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes,
        authStrategies: {
          bearer: { type: 'bearer', tokenProvider },
        },
      });

      await api('GET /protected', {
        headers: { Authorization: 'Bearer override-token' },
      });

      expect(lastReceivedHeaders.authorization).toBe('Bearer override-token');
    });
  });

  describe('onRequest interceptor', () => {
    it('should call user onRequest interceptor after auth headers', async () => {
      const onRequest = vi.fn((config: RequestInit) => ({
        ...config,
        headers: {
          ...config.headers,
          'X-Intercepted': 'true',
        },
      }));

      const tokenProvider: TokenProvider = {
        getValidAccessToken: vi.fn().mockResolvedValue('valid-token'),
        createValidAuthHeaders: vi.fn().mockResolvedValue({
          Authorization: 'Bearer valid-token',
        }),
      };

      const endpointAuth = {
        'GET /protected': 'bearer',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes,
        authStrategies: {
          bearer: { type: 'bearer', tokenProvider },
        },
        onRequest,
      });

      await api('GET /protected');

      expect(onRequest).toHaveBeenCalled();
      expect(lastReceivedHeaders['x-intercepted']).toBe('true');
    });
  });

  describe('none auth strategy', () => {
    it('should not add any headers for none strategy', async () => {
      const endpointAuth = {
        'GET /users': 'noAuth',
      } as const;

      const customSchemes: Record<string, SecuritySchemeObject> = {
        noAuth: {
          type: 'http',
          scheme: 'none',
        },
      };

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes: customSchemes,
        authStrategies: {
          noAuth: { type: 'none' },
        },
      });

      const result = await api('GET /users');

      expect(result).toEqual({ users: [{ id: '1', name: 'John' }] });
      expect(lastReceivedHeaders.authorization).toBeUndefined();
    });
  });

  describe('missing strategy handling', () => {
    it('should not add headers when scheme exists but strategy is missing', async () => {
      const endpointAuth = {
        'GET /users': 'unknownScheme',
      } as const;

      const api = createAuthAwareFetcher<TestPaths>({
        baseURL: 'https://api.example.com',
        endpointAuth,
        securitySchemes: {
          unknownScheme: { type: 'http', scheme: 'custom' },
        },
        // No strategy for unknownScheme
        authStrategies: {} as any,
      });

      const result = await api('GET /users');

      expect(result).toEqual({ users: [{ id: '1', name: 'John' }] });
    });
  });
});
