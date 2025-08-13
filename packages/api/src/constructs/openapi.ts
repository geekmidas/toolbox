import type { OpenAPIV3_1 } from 'openapi-types';
import type { Endpoint } from './Endpoint';

export interface OpenApiSchemaOptions {
  title?: string;
  version?: string;
  description?: string;
}

export interface ComponentCollector {
  schemas: Record<string, OpenAPIV3_1.SchemaObject>;
  addSchema(id: string, schema: OpenAPIV3_1.SchemaObject): void;
  getReference(id: string): OpenAPIV3_1.ReferenceObject;
}

export function createComponentCollector(): ComponentCollector {
  const schemas: Record<string, OpenAPIV3_1.SchemaObject> = {};

  return {
    schemas,
    addSchema(id: string, schema: OpenAPIV3_1.SchemaObject) {
      schemas[id] = schema;
    },
    getReference(id: string): OpenAPIV3_1.ReferenceObject {
      return { $ref: `#/components/schemas/${id}` };
    },
  };
}

export async function buildOpenApiSchema(
  endpoints: Endpoint<any, any, any, any, any, any>[],
  options: OpenApiSchemaOptions = {},
): Promise<OpenAPIV3_1.Document> {
  const { title = 'API', version = '1.0.0', description } = options;
  const paths: OpenAPIV3_1.PathsObject = {};
  const componentCollector = createComponentCollector();

  for (const endpoint of endpoints) {
    const route = await endpoint.toOpenApi3Route(componentCollector);

    // Merge the route into the paths object
    for (const [path, methods] of Object.entries(route)) {
      if (!paths[path]) {
        paths[path] = {};
      }
      Object.assign(paths[path], methods);
    }
  }

  const doc: OpenAPIV3_1.Document = {
    openapi: '3.0.0',
    info: {
      title,
      version,
      ...(description && { description }),
    },
    paths,
  };

  // Add components if any schemas were collected
  if (Object.keys(componentCollector.schemas).length > 0) {
    doc.components = {
      schemas: componentCollector.schemas,
    };
  }

  return doc;
}
