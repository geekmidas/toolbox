#!/usr/bin/env -S npx tsx

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface ReactQueryOptions {
  input?: string;
  output?: string;
  name?: string;
}

interface OpenAPISpec {
  openapi: string;
  info?: {
    title?: string;
    version?: string;
  };
  paths: Record<string, Record<string, any>>;
}

export async function generateReactQueryCommand(
  options: ReactQueryOptions = {},
): Promise<void> {
  const logger = console;

  try {
    // Read OpenAPI spec
    const inputPath = options.input || join(process.cwd(), 'openapi.json');
    
    if (!existsSync(inputPath)) {
      throw new Error(`OpenAPI spec not found at ${inputPath}. Run 'npx @geekmidas/cli openapi' first.`);
    }

    const specContent = await readFile(inputPath, 'utf-8');
    const spec: OpenAPISpec = JSON.parse(specContent);

    // Generate TypeScript types from OpenAPI spec
    const outputDir = dirname(options.output || join(process.cwd(), 'src', 'api', 'hooks.ts'));
    const typesPath = join(outputDir, 'openapi-types.d.ts');
    
    logger.log('Generating TypeScript types from OpenAPI spec...');
    
    try {
      // Use npx to run openapi-typescript
      await execAsync(
        `npx openapi-typescript "${inputPath}" -o "${typesPath}"`,
        { cwd: process.cwd() }
      );
      logger.log(`TypeScript types generated: ${typesPath}`);
    } catch (error) {
      logger.warn('Could not generate types with openapi-typescript. Install it for better type inference.');
      logger.warn('Run: npm install -D openapi-typescript');
      
      // Generate basic types file
      await writeFile(typesPath, `// Auto-generated placeholder types
export interface paths {
  [path: string]: {
    [method: string]: {
      operationId?: string;
      parameters?: any;
      requestBody?: any;
      responses?: any;
    };
  };
}
`);
    }

    // Extract operation info
    const operations = extractOperations(spec);
    
    // Generate TypeScript code
    const code = generateReactQueryCode(spec, operations, options.name || 'API');

    // Write output
    const outputPath = options.output || join(process.cwd(), 'src', 'api', 'hooks.ts');
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, code);

    logger.log(`React Query hooks generated: ${outputPath}`);
    logger.log(`Generated ${operations.length} hooks`);
  } catch (error) {
    throw new Error(`React Query generation failed: ${(error as Error).message}`);
  }
}

interface OperationInfo {
  operationId: string;
  path: string;
  method: string;
  endpoint: string; // Full endpoint like 'GET /users/{id}'
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  requestBody?: boolean;
  responseType?: string;
}

function extractOperations(spec: OpenAPISpec): OperationInfo[] {
  const operations: OperationInfo[] = [];

  Object.entries(spec.paths).forEach(([path, methods]) => {
    Object.entries(methods).forEach(([method, operation]) => {
      if (operation.operationId) {
        operations.push({
          operationId: operation.operationId,
          path,
          method: method.toUpperCase(),
          endpoint: `${method.toUpperCase()} ${path}`,
          parameters: operation.parameters,
          requestBody: !!operation.requestBody,
          responseType: extractResponseType(operation),
        });
      }
    });
  });

  return operations;
}

function extractResponseType(operation: any): string {
  const responses = operation.responses;
  if (!responses) return 'unknown';

  const successResponse = responses['200'] || responses['201'];
  if (!successResponse?.content?.['application/json']?.schema) {
    return 'unknown';
  }

  // Basic type inference from schema
  const schema = successResponse.content['application/json'].schema;
  return schemaToTypeString(schema);
}

function schemaToTypeString(schema: any): string {
  if (!schema) return 'unknown';
  
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `Array<${schemaToTypeString(schema.items)}>`;
    case 'object':
      if (schema.properties) {
        const props = Object.entries(schema.properties)
          .map(([key, value]: [string, any]) => `${key}: ${schemaToTypeString(value)}`)
          .join('; ');
        return `{ ${props} }`;
      }
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

function generateReactQueryCode(
  spec: OpenAPISpec,
  operations: OperationInfo[],
  apiName: string,
): string {
  const imports = `import { createTypedQueryClient } from '@geekmidas/api/client';
import type { paths } from './openapi-types';

// Create typed query client
export const ${apiName.toLowerCase()} = createTypedQueryClient<paths>({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api',
});

// Export individual hooks for better DX
`;

  const queryHooks = operations
    .filter(op => op.method === 'GET')
    .map(op => generateQueryHook(op, apiName))
    .join('\n\n');

  const mutationHooks = operations
    .filter(op => op.method !== 'GET')
    .map(op => generateMutationHook(op, apiName))
    .join('\n\n');

  const typeExports = generateTypeExports(operations);

  return `${imports}
// Query Hooks
${queryHooks}

// Mutation Hooks
${mutationHooks}

// Type exports for convenience
${typeExports}

// Re-export the api for advanced usage
export { ${apiName.toLowerCase()} };
`;
}

function generateQueryHook(op: OperationInfo, apiName: string): string {
  const hookName = `use${capitalize(op.operationId)}`;
  const endpoint = op.endpoint;
  const hasParams = op.parameters?.some(p => p.in === 'path');
  const hasQuery = op.parameters?.some(p => p.in === 'query');
  
  // Generate properly typed hook
  let params = '';
  let args = '';
  
  if (hasParams || hasQuery) {
    const paramParts: string[] = [];
    if (hasParams) {
      const pathParams = op.parameters?.filter(p => p.in === 'path').map(p => p.name) || [];
      paramParts.push(`params: { ${pathParams.map(p => `${p}: string`).join('; ')} }`);
    }
    if (hasQuery) {
      paramParts.push(`query?: Record<string, any>`);
    }
    params = `config: { ${paramParts.join('; ')} }, `;
    args = ', config';
  }
  
  return `export const ${hookName} = (
  ${params}options?: Parameters<typeof ${apiName.toLowerCase()}.useQuery>[2]
) => {
  return ${apiName.toLowerCase()}.useQuery('${endpoint}' as any${args}, options);
};`;
}

function generateMutationHook(op: OperationInfo, apiName: string): string {
  const hookName = `use${capitalize(op.operationId)}`;
  const endpoint = op.endpoint;
  
  return `export const ${hookName} = (
  options?: Parameters<typeof ${apiName.toLowerCase()}.useMutation>[1]
) => {
  return ${apiName.toLowerCase()}.useMutation('${endpoint}' as any, options);
};`;
}

function generateTypeExports(operations: OperationInfo[]): string {
  const exports = operations.map(op => {
    const typeName = capitalize(op.operationId);
    const isQuery = op.method === 'GET';
    
    if (isQuery) {
      return `export type ${typeName}Response = Awaited<ReturnType<ReturnType<typeof use${typeName}>['data']>>;`;
    } else {
      return `export type ${typeName}Response = Awaited<ReturnType<ReturnType<typeof use${typeName}>['mutateAsync']>>;`;
    }
  });

  return exports.join('\n');
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}