import type { Endpoint } from '@geekmidas/constructs/endpoints';
import {
  convertStandardSchemaToJsonSchema,
  getSchemaMetadata,
  StandardSchemaJsonSchema,
} from '@geekmidas/schema/conversion';
import type { StandardSchemaV1 } from '@standard-schema/spec';

interface OpenApiTsOptions {
  title?: string;
  version?: string;
  description?: string;
}

// JSON Schema type definition
interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  $ref?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

// Security scheme type (OpenAPI 3.1)
interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'mutualTLS' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
  [key: string]: unknown;
}

interface EndpointInfo {
  endpoint: string;
  route: string;
  method: string;
  authorizerName: string | null;
  /** @deprecated Use securityScheme instead */
  authorizerType: string | null;
  /** The OpenAPI security scheme definition for this endpoint's authorizer */
  securityScheme: SecuritySchemeObject | null;
  input?: {
    body?: StandardSchemaV1;
    query?: StandardSchemaV1;
    params?: StandardSchemaV1;
  };
  output?: StandardSchemaV1;
  description?: string;
  tags?: string[];
  operationId?: string;
}

interface SecuritySchemeInfo {
  name: string;
  type: string;
  scheme: SecuritySchemeObject;
}

/**
 * Generates TypeScript OpenAPI module from endpoints.
 * Outputs:
 * - securitySchemes: typed security scheme definitions
 * - endpointAuth: runtime map of endpoints to auth requirements
 * - paths: TypeScript interface for type-safe fetcher
 * - schema interfaces: reusable TypeScript types from Zod/Valibot schemas
 */
export class OpenApiTsGenerator {
  async generate(
    endpoints: Endpoint<any, any, any, any, any, any>[],
    options: OpenApiTsOptions = {},
  ): Promise<string> {
    const { title = 'API', version = '1.0.0', description } = options;

    // Extract endpoint info
    const endpointInfos = await this.extractEndpointInfos(endpoints);

    // Collect unique security schemes
    const securitySchemes = this.collectSecuritySchemes(endpointInfos);

    // Build endpoint auth map
    const endpointAuth = this.buildEndpointAuthMap(endpointInfos);

    // Generate schema interfaces
    const schemaInterfaces = await this.generateSchemaInterfaces(endpointInfos);

    // Generate paths interface
    const pathsInterface = await this.generatePathsInterface(endpointInfos);

    // Build the final TypeScript module
    return this.buildModule({
      title,
      version,
      description,
      securitySchemes,
      endpointAuth,
      schemaInterfaces,
      pathsInterface,
    });
  }

  private async extractEndpointInfos(
    endpoints: Endpoint<any, any, any, any, any, any>[],
  ): Promise<EndpointInfo[]> {
    return endpoints.map((ep) => {
      const route = ep.route.replace(/:(\w+)/g, '{$1}');
      const method = ep.method.toUpperCase();

      // Get security scheme from authorizer (if available)
      // This is the preferred way - the scheme is stored directly on the authorizer
      const securityScheme = ep.authorizer?.securityScheme as
        | SecuritySchemeObject
        | undefined;

      return {
        endpoint: `${method} ${route}`,
        route,
        method,
        authorizerName: ep.authorizer?.name ?? null,
        authorizerType: ep.authorizer?.type ?? null,
        securityScheme: securityScheme ?? null,
        input: ep.input,
        output: ep.outputSchema,
        description: ep.description,
        tags: ep.tags,
        operationId: ep.operationId,
      };
    });
  }

  private collectSecuritySchemes(
    endpointInfos: EndpointInfo[],
  ): SecuritySchemeInfo[] {
    const schemes = new Map<string, SecuritySchemeInfo>();

    for (const info of endpointInfos) {
      if (info.authorizerName && !schemes.has(info.authorizerName)) {
        // Prefer the stored security scheme (from .securitySchemes() or built-ins)
        // Fall back to inference from authorizerType for backward compatibility
        const scheme =
          info.securityScheme ??
          (info.authorizerType
            ? this.mapAuthorizerToSecurityScheme(
                info.authorizerType,
                info.authorizerName,
              )
            : null);

        if (scheme) {
          schemes.set(info.authorizerName, {
            name: info.authorizerName,
            type: scheme.type,
            scheme,
          });
        }
      }
    }

    return Array.from(schemes.values());
  }

  private mapAuthorizerToSecurityScheme(
    type: string,
    _name: string,
  ): SecuritySchemeObject {
    switch (type.toLowerCase()) {
      case 'jwt':
      case 'bearer':
        return {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        };
      case 'iam':
      case 'aws-sigv4':
      case 'sigv4':
        return {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          'x-amazon-apigateway-authtype': 'awsSigv4',
        };
      case 'apikey':
      case 'api-key':
        return {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        };
      case 'oauth2':
        return {
          type: 'oauth2',
          flows: {},
        };
      case 'oidc':
      case 'openidconnect':
        return {
          type: 'openIdConnect',
          openIdConnectUrl: '',
        };
      default:
        return {
          type: 'http',
          scheme: 'bearer',
        };
    }
  }

  private buildEndpointAuthMap(
    endpointInfos: EndpointInfo[],
  ): Record<string, string | null> {
    const authMap: Record<string, string | null> = {};

    for (const info of endpointInfos) {
      authMap[info.endpoint] = info.authorizerName;
    }

    return authMap;
  }

  private async generateSchemaInterfaces(
    endpointInfos: EndpointInfo[],
  ): Promise<string> {
    const interfaces: string[] = [];
    const generatedNames = new Set<string>();
    // Collect nested schemas with $defs (from .meta({ id: 'X' }))
    const collectedDefs = new Map<string, JsonSchema>();

    for (const info of endpointInfos) {
      const baseName = this.getSchemaBaseName(info);

      // Input body schema
      if (info.input?.body) {
        const name = await this.getSchemaName(
          info.input.body,
          `${baseName}Input`,
        );
        if (!generatedNames.has(name)) {
          const schema = await this.schemaToInterfaceWithDefs(
            info.input.body,
            name,
            collectedDefs,
          );
          if (schema) {
            interfaces.push(schema);
            generatedNames.add(name);
          }
        }
      }

      // Input params schema
      if (info.input?.params) {
        const name = await this.getSchemaName(
          info.input.params,
          `${baseName}Params`,
        );
        if (!generatedNames.has(name)) {
          const schema = await this.schemaToInterfaceWithDefs(
            info.input.params,
            name,
            collectedDefs,
          );
          if (schema) {
            interfaces.push(schema);
            generatedNames.add(name);
          }
        }
      }

      // Input query schema
      if (info.input?.query) {
        const name = await this.getSchemaName(
          info.input.query,
          `${baseName}Query`,
        );
        if (!generatedNames.has(name)) {
          const schema = await this.schemaToInterfaceWithDefs(
            info.input.query,
            name,
            collectedDefs,
          );
          if (schema) {
            interfaces.push(schema);
            generatedNames.add(name);
          }
        }
      }

      // Output schema
      if (info.output) {
        const name = await this.getSchemaName(info.output, `${baseName}Output`);
        if (!generatedNames.has(name)) {
          const schema = await this.schemaToInterfaceWithDefs(
            info.output,
            name,
            collectedDefs,
          );
          if (schema) {
            interfaces.push(schema);
            generatedNames.add(name);
          }
        }
      }
    }

    // Generate interfaces for collected $defs (nested schemas with .meta({ id: 'X' }))
    for (const [defName, defSchema] of collectedDefs) {
      if (!generatedNames.has(defName)) {
        const interfaceStr = this.jsonSchemaToInterface(defSchema, defName);
        interfaces.push(interfaceStr);
        generatedNames.add(defName);
      }
    }

    return interfaces.join('\n\n');
  }

  /**
   * Get the name for a schema, using metadata `id` if available,
   * otherwise falling back to the provided default name.
   */
  private async getSchemaName(
    schema: StandardSchemaV1,
    defaultName: string,
  ): Promise<string> {
    try {
      const metadata = await getSchemaMetadata(schema);
      if (metadata?.id) {
        return this.pascalCase(metadata.id);
      }
    } catch {
      // Ignore metadata extraction errors
    }
    return defaultName;
  }

  private getSchemaBaseName(info: EndpointInfo): string {
    if (info.operationId) {
      return this.pascalCase(info.operationId);
    }

    // Generate name from method + route
    const routeParts = info.route
      .replace(/[{}]/g, '')
      .split('/')
      .filter(Boolean)
      .map((part) => this.pascalCase(part));

    return `${this.pascalCase(info.method.toLowerCase())}${routeParts.join('')}`;
  }

  private pascalCase(str: string): string {
    return str
      .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
      .replace(/^./, (c) => c.toUpperCase());
  }

  private async schemaToInterface(
    schema: StandardSchemaV1,
    name: string,
  ): Promise<string | null> {
    try {
      const jsonSchema = await convertStandardSchemaToJsonSchema(schema);
      if (!jsonSchema) return null;

      return this.jsonSchemaToInterface(jsonSchema, name);
    } catch {
      return null;
    }
  }

  /**
   * Convert schema to interface while collecting $defs for nested schemas
   * with .meta({ id: 'X' }).
   */
  private async schemaToInterfaceWithDefs(
    schema: StandardSchemaV1,
    name: string,
    collectedDefs: Map<string, JsonSchema>,
  ): Promise<string | null> {
    try {
      // Get raw JSON schema with $defs intact (don't use convertStandardSchemaToJsonSchema
      // which strips $defs)
      const vendor = schema['~standard']?.vendor;
      if (!vendor || !(vendor in StandardSchemaJsonSchema)) {
        return null;
      }

      const toJsonSchema =
        StandardSchemaJsonSchema[vendor as keyof typeof StandardSchemaJsonSchema];
      const jsonSchema = await toJsonSchema(schema);
      if (!jsonSchema) return null;

      // Extract $defs from the JSON schema (these come from .meta({ id: 'X' }))
      if (jsonSchema.$defs && typeof jsonSchema.$defs === 'object') {
        for (const [defName, defSchema] of Object.entries(jsonSchema.$defs)) {
          if (!collectedDefs.has(defName)) {
            // Remove the 'id' field from the schema as it's just metadata
            const { id, ...schemaWithoutId } = defSchema as JsonSchema & { id?: string };
            collectedDefs.set(defName, schemaWithoutId as JsonSchema);
          }
        }
      }

      // Remove $defs from the schema before converting to interface
      const { $defs, ...schemaWithoutDefs } = jsonSchema;
      return this.jsonSchemaToInterface(schemaWithoutDefs, name);
    } catch {
      return null;
    }
  }

  private jsonSchemaToInterface(schema: JsonSchema, name: string): string {
    if (schema.type !== 'object' || !schema.properties) {
      // For non-object types, create a type alias
      const typeStr = this.jsonSchemaTypeToTs(schema);
      return `export type ${name} = ${typeStr};`;
    }

    const props: string[] = [];
    const required = new Set(schema.required || []);

    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const isRequired = required.has(propName);
      const typeStr = this.jsonSchemaTypeToTs(propSchema as JsonSchema);
      const optionalMark = isRequired ? '' : '?';
      props.push(`  ${propName}${optionalMark}: ${typeStr};`);
    }

    return `export interface ${name} {\n${props.join('\n')}\n}`;
  }

  private jsonSchemaTypeToTs(schema: JsonSchema): string {
    if (!schema) return 'unknown';

    if (schema.$ref) {
      // Extract name from $ref
      const refName = schema.$ref.split('/').pop() || 'unknown';
      return refName;
    }

    if (schema.anyOf) {
      return schema.anyOf
        .map((s: JsonSchema) => this.jsonSchemaTypeToTs(s))
        .join(' | ');
    }

    if (schema.oneOf) {
      return schema.oneOf
        .map((s: JsonSchema) => this.jsonSchemaTypeToTs(s))
        .join(' | ');
    }

    if (schema.allOf) {
      return schema.allOf
        .map((s: JsonSchema) => this.jsonSchemaTypeToTs(s))
        .join(' & ');
    }

    switch (schema.type) {
      case 'string':
        if (schema.enum) {
          return schema.enum.map((e: string) => `'${e}'`).join(' | ');
        }
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      case 'array':
        if (schema.items) {
          return `Array<${this.jsonSchemaTypeToTs(schema.items as JsonSchema)}>`;
        }
        return 'Array<unknown>';
      case 'object':
        if (schema.properties) {
          const props: string[] = [];
          const required = new Set(schema.required || []);
          for (const [propName, propSchema] of Object.entries(
            schema.properties,
          )) {
            const isRequired = required.has(propName);
            const typeStr = this.jsonSchemaTypeToTs(propSchema as JsonSchema);
            const optionalMark = isRequired ? '' : '?';
            props.push(`${propName}${optionalMark}: ${typeStr}`);
          }
          return `{ ${props.join('; ')} }`;
        }
        if (schema.additionalProperties) {
          const valueType = this.jsonSchemaTypeToTs(
            schema.additionalProperties as JsonSchema,
          );
          return `Record<string, ${valueType}>`;
        }
        return 'Record<string, unknown>';
      default:
        return 'unknown';
    }
  }

  private async generatePathsInterface(
    endpointInfos: EndpointInfo[],
  ): Promise<string> {
    const pathGroups = new Map<string, EndpointInfo[]>();

    // Group endpoints by route
    for (const info of endpointInfos) {
      const existing = pathGroups.get(info.route) || [];
      existing.push(info);
      pathGroups.set(info.route, existing);
    }

    const pathEntries: string[] = [];

    for (const [route, infos] of pathGroups) {
      const methodEntries: string[] = [];

      for (const info of infos) {
        const methodDef = await this.generateMethodDefinition(info);
        methodEntries.push(`    ${info.method.toLowerCase()}: ${methodDef};`);
      }

      // Add path parameters if present
      const firstWithParams = infos.find((i) => i.input?.params);
      let paramsEntry = '';
      if (firstWithParams?.input?.params) {
        const paramsName = await this.getSchemaName(
          firstWithParams.input.params,
          `${this.getSchemaBaseName(firstWithParams)}Params`,
        );
        paramsEntry = `\n    parameters: {\n      path: ${paramsName};\n    };`;
      }

      pathEntries.push(
        `  '${route}': {${paramsEntry}\n${methodEntries.join('\n')}\n  };`,
      );
    }

    return `export interface paths {\n${pathEntries.join('\n')}\n}`;
  }

  private async generateMethodDefinition(info: EndpointInfo): Promise<string> {
    const parts: string[] = [];
    const baseName = this.getSchemaBaseName(info);

    // Request body
    if (info.input?.body) {
      const bodyName = await this.getSchemaName(info.input.body, `${baseName}Input`);
      parts.push(`requestBody: {
      content: {
        'application/json': ${bodyName};
      };
    }`);
    }

    // Query parameters
    if (info.input?.query) {
      const queryName = await this.getSchemaName(info.input.query, `${baseName}Query`);
      parts.push(`parameters: {
      query: ${queryName};
    }`);
    }

    // Responses
    const outputName = info.output
      ? await this.getSchemaName(info.output, `${baseName}Output`)
      : 'unknown';
    parts.push(`responses: {
      200: {
        content: {
          'application/json': ${outputName};
        };
      };
    }`);

    return `{\n      ${parts.join(';\n      ')};\n    }`;
  }

  private buildModule(params: {
    title: string;
    version: string;
    description?: string;
    securitySchemes: SecuritySchemeInfo[];
    endpointAuth: Record<string, string | null>;
    schemaInterfaces: string;
    pathsInterface: string;
  }): string {
    const {
      title,
      version,
      description,
      securitySchemes,
      endpointAuth,
      schemaInterfaces,
      pathsInterface,
    } = params;

    const securitySchemesObj = securitySchemes.reduce(
      (acc, s) => {
        acc[s.name] = s.scheme;
        return acc;
      },
      {} as Record<string, SecuritySchemeObject>,
    );

    const schemeNames = securitySchemes.map((s) => `'${s.name}'`).join(' | ');

    // Generate createApi only if there are security schemes
    const hasSecuritySchemes = schemeNames.length > 0;

    const createApiSection = hasSecuritySchemes
      ? `
// ============================================================
// API Client Factory
// ============================================================

import {
  createAuthAwareFetcher,
  type AuthStrategy,
} from '@geekmidas/client/auth-fetcher';
import { createOpenAPIHooks } from '@geekmidas/client/react-query';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Options for creating the API client.
 */
export interface CreateApiOptions {
  /** Base URL for all API requests (required) */
  baseURL: string;
  /** Auth strategies for each security scheme used in this API */
  authStrategies: Record<SecuritySchemeId, AuthStrategy>;
  /** Optional React Query client instance */
  queryClient?: QueryClient;
  /** Optional request interceptor */
  onRequest?: (config: RequestInit) => RequestInit | Promise<RequestInit>;
}

/**
 * Create a type-safe API client with authentication and React Query hooks.
 *
 * @example
 * \`\`\`typescript
 * const api = createApi({
 *   baseURL: 'https://api.example.com',
 *   authStrategies: {
 *     jwt: { type: 'bearer', tokenProvider },
 *   },
 * });
 *
 * // Imperative fetch
 * const user = await api('GET /users/{id}', { params: { id: '123' } });
 *
 * // React Query hooks
 * const { data } = api.useQuery('GET /users/{id}', { params: { id: '123' } });
 * const mutation = api.useMutation('POST /users');
 * \`\`\`
 */
export function createApi(options: CreateApiOptions) {
  const fetcher = createAuthAwareFetcher<paths, typeof endpointAuth, typeof securitySchemes>({
    baseURL: options.baseURL,
    endpointAuth,
    securitySchemes,
    authStrategies: options.authStrategies,
    onRequest: options.onRequest,
  });

  const hooks = createOpenAPIHooks<paths>(fetcher, options.queryClient);

  return Object.assign(fetcher, hooks);
}
`
      : `
// ============================================================
// API Client Factory
// ============================================================

import { TypedFetcher, type FetcherOptions } from '@geekmidas/client/fetcher';
import { createOpenAPIHooks } from '@geekmidas/client/react-query';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Options for creating the API client.
 */
export interface CreateApiOptions extends Omit<FetcherOptions, 'baseURL'> {
  /** Base URL for all API requests (required) */
  baseURL: string;
  /** Optional React Query client instance */
  queryClient?: QueryClient;
}

/**
 * Create a type-safe API client with React Query hooks.
 *
 * @example
 * \`\`\`typescript
 * const api = createApi({
 *   baseURL: 'https://api.example.com',
 * });
 *
 * // Imperative fetch
 * const data = await api('GET /health');
 *
 * // React Query hooks
 * const { data } = api.useQuery('GET /health');
 * \`\`\`
 */
export function createApi(options: CreateApiOptions) {
  const { queryClient, ...fetcherOptions } = options;
  const fetcher = new TypedFetcher<paths>(fetcherOptions);

  const hooks = createOpenAPIHooks<paths>(fetcher.request.bind(fetcher), queryClient);

  return Object.assign(fetcher.request.bind(fetcher), hooks);
}
`;

    return `// Auto-generated by @geekmidas/cli - DO NOT EDIT
// Generated: ${new Date().toISOString()}

// ============================================================
// Security Scheme Type
// ============================================================

interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'mutualTLS' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
  [key: string]: unknown;
}

// ============================================================
// API Info
// ============================================================

export const apiInfo = {
  title: '${title}',
  version: '${version}',${description ? `\n  description: '${description.replace(/'/g, "\\'")}',` : ''}
} as const;

// ============================================================
// Security Schemes
// ============================================================

/**
 * Available security schemes for this API.
 * Maps authorizer names to OpenAPI security scheme definitions.
 */
export const securitySchemes = ${JSON.stringify(securitySchemesObj, null, 2).replace(/"([^"]+)":/g, '$1:')} as const satisfies Record<string, SecuritySchemeObject>;

export type SecuritySchemeId = ${schemeNames || 'never'};

// ============================================================
// Endpoint Authentication Map
// ============================================================

/**
 * Runtime map of endpoints to their required authentication scheme.
 * \`null\` indicates a public endpoint (no auth required).
 */
export const endpointAuth = ${JSON.stringify(endpointAuth, null, 2).replace(/"([^"]+)":/g, "'$1':")} as const satisfies Record<string, SecuritySchemeId | null>;

export type EndpointString = keyof typeof endpointAuth;

export type AuthenticatedEndpoint = {
  [K in EndpointString]: typeof endpointAuth[K] extends null ? never : K;
}[EndpointString];

export type PublicEndpoint = {
  [K in EndpointString]: typeof endpointAuth[K] extends null ? K : never;
}[EndpointString];

// ============================================================
// Schema Definitions
// ============================================================

${schemaInterfaces}

// ============================================================
// OpenAPI Paths
// ============================================================

${pathsInterface}
${createApiSection}
`;
  }
}
