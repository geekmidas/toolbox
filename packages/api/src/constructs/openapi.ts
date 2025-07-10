import type { OpenAPIV3_1 } from 'openapi-types';
import type { Endpoint } from './Endpoint';

export interface OpenApiSchemaOptions {
  title?: string;
  version?: string;
  description?: string;
}

export async function buildOpenApiSchema(
  endpoints: Endpoint<any, any, any, any, any, any>[],
  options: OpenApiSchemaOptions = {},
): Promise<OpenAPIV3_1.Document> {
  const { title = 'API', version = '1.0.0', description } = options;
  const paths: OpenAPIV3_1.PathsObject = {};

  for (const endpoint of endpoints) {
    const route = await endpoint.toOpenApi3Route();

    // Merge the route into the paths object
    for (const [path, methods] of Object.entries(route)) {
      if (!paths[path]) {
        paths[path] = {};
      }
      Object.assign(paths[path], methods);
    }
  }

  return {
    openapi: '3.0.0',
    info: {
      title,
      version,
      ...(description && { description }),
    },
    paths,
  };
}
