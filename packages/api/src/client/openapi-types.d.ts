/**
 * This file should be auto-generated by openapi-typescript.
 * Run: npx openapi-typescript <your-openapi-spec> -o ./openapi-types.d.ts
 *
 * This is a placeholder file showing the expected structure.
 */

export interface paths {
  '/users': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': {
              users: Array<{
                id: string;
                name: string;
                email: string;
              }>;
            };
          };
        };
      };
    };
    post: {
      requestBody: {
        content: {
          'application/json': {
            name: string;
            email: string;
          };
        };
      };
      responses: {
        201: {
          content: {
            'application/json': {
              id: string;
              name: string;
              email: string;
            };
          };
        };
      };
    };
  };
  '/users/{id}': {
    parameters: {
      path: {
        id: string;
      };
    };
    get: {
      responses: {
        200: {
          content: {
            'application/json': {
              id: string;
              name: string;
              email: string;
            };
          };
        };
      };
    };
    put: {
      requestBody: {
        content: {
          'application/json': {
            name?: string;
            email?: string;
          };
        };
      };
      responses: {
        200: {
          content: {
            'application/json': {
              id: string;
              name: string;
              email: string;
            };
          };
        };
      };
    };
    delete: {
      responses: {
        204: {
          content: never;
        };
      };
    };
  };
  '/posts': {
    get: {
      parameters: {
        query: {
          page?: number;
          limit?: number;
          sort?: 'asc' | 'desc';
        };
      };
      responses: {
        200: {
          content: {
            'application/json': {
              posts: Array<{
                id: string;
                title: string;
                content: string;
                authorId: string;
                createdAt: string;
              }>;
              pagination: {
                page: number;
                limit: number;
                total: number;
              };
              sort: 'asc' | 'desc';
            };
          };
        };
      };
    };
  };
  '/protected': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': {
              message: string;
            };
          };
        };
        401: {
          content: {
            'application/json': {
              message: string;
            };
          };
        };
      };
    };
  };
  '/error': {
    get: {
      responses: {
        500: {
          content: {
            'application/json': {
              message: string;
            };
          };
        };
      };
    };
  };
}

export interface components {
  schemas: {
    User: {
      id: string;
      name: string;
      email: string;
    };
    Post: {
      id: string;
      title: string;
      content: string;
      authorId: string;
      createdAt: string;
    };
  };
}
