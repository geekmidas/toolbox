/**
 * Handler Templates for Build-Time Code Generation
 *
 * Generates optimized handler code based on endpoint tier:
 * - minimal: Near-raw-Hono performance for simple endpoints
 * - standard: Middleware composition for auth/services
 * - full: Complete handler chain for complex endpoints
 *
 * Output structure (split by tier):
 * - endpoints/validators.ts - Shared validator factories
 * - endpoints/minimal.ts - Minimal tier handlers
 * - endpoints/standard.ts - Standard tier handlers
 * - endpoints/full.ts - Full tier handlers
 * - endpoints/index.ts - Main entry point
 */
import type { EndpointAnalysis, EndpointFeatures } from './endpoint-analyzer';

/**
 * Multi-file output structure (flat by tier)
 */
export interface GeneratedEndpointFiles {
  'validators.ts': string;
  'minimal.ts': string;
  'standard.ts': string;
  'full.ts': string;
  'index.ts': string;
}

/**
 * Nested folder structure with per-endpoint files
 *
 * Structure:
 * - endpoints/validators.ts
 * - endpoints/minimal/index.ts
 * - endpoints/minimal/[endpointName].ts
 * - endpoints/standard/index.ts
 * - endpoints/standard/[endpointName].ts
 * - endpoints/full/index.ts
 * - endpoints/full/[endpointName].ts
 * - endpoints/index.ts
 */
export interface GeneratedEndpointFilesNested {
  'validators.ts': string;
  'minimal/index.ts': string;
  'standard/index.ts': string;
  'full/index.ts': string;
  'index.ts': string;
  [path: string]: string; // e.g., 'minimal/healthEndpoint.ts'
}

/**
 * Endpoint import info for generating import statements
 */
export interface EndpointImportInfo {
  exportName: string;
  importPath: string;
}

/**
 * Generate imports needed for optimized endpoints file
 */
export function generateOptimizedImports(analyses: EndpointAnalysis[]): string {
  const needsValidator = analyses.some(
    (a) =>
      a.features.hasBodyValidation ||
      a.features.hasQueryValidation ||
      a.features.hasParamValidation,
  );

  const needsResponseBuilder = analyses.some(
    (a) => a.tier === 'standard' || a.tier === 'full',
  );

  const needsServiceDiscovery = analyses.some(
    (a) => a.features.hasServices || a.features.hasDatabase,
  );

  const needsEvents = analyses.some((a) => a.features.hasEvents);

  const needsAudits = analyses.some((a) => a.features.hasAudits);

  const needsRateLimit = analyses.some((a) => a.features.hasRateLimit);

  const needsRls = analyses.some((a) => a.features.hasRls);

  const imports: string[] = [
    `import type { EnvironmentParser } from '@geekmidas/envkit';`,
    `import type { Logger } from '@geekmidas/logger';`,
    `import type { Hono } from 'hono';`,
  ];

  if (needsValidator) {
    imports.push(`import { validator } from 'hono/validator';`);
  }

  imports.push(`import { Endpoint } from '@geekmidas/constructs/endpoints';`);

  if (needsResponseBuilder) {
    imports.push(
      `import { ResponseBuilder } from '@geekmidas/constructs/endpoints';`,
    );
  }

  if (needsServiceDiscovery) {
    imports.push(`import { ServiceDiscovery } from '@geekmidas/services';`);
  }

  if (needsEvents) {
    imports.push(
      `import { publishConstructEvents } from '@geekmidas/constructs/endpoints';`,
    );
  }

  if (needsAudits) {
    imports.push(
      `import { createAuditContext, withAuditableEndpointTransaction } from '@geekmidas/constructs/endpoints';`,
    );
  }

  if (needsRateLimit) {
    imports.push(`import { createError } from '@geekmidas/errors';`);
  }

  if (needsRls) {
    imports.push(
      `import { withRlsContext, extractRlsContext } from '@geekmidas/constructs/endpoints';`,
    );
  }

  return imports.join('\n');
}

/**
 * Generate reusable validator middleware factories
 */
export function generateValidatorFactories(
  analyses: EndpointAnalysis[],
): string {
  const needsBody = analyses.some((a) => a.features.hasBodyValidation);
  const needsQuery = analyses.some((a) => a.features.hasQueryValidation);
  const needsParams = analyses.some((a) => a.features.hasParamValidation);

  if (!needsBody && !needsQuery && !needsParams) {
    return '';
  }

  const factories: string[] = [];

  if (needsBody) {
    factories.push(`
const validateBody = (endpoint: any) =>
  validator('json', async (value, c) => {
    if (!endpoint.input?.body) return undefined;
    const parsed = await Endpoint.validate(endpoint.input.body, value);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });`);
  }

  if (needsQuery) {
    factories.push(`
const validateQuery = (endpoint: any) =>
  validator('query', async (_, c) => {
    if (!endpoint.input?.query) return undefined;
    const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = await Endpoint.validate(endpoint.input.query, rawQuery);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });`);
  }

  if (needsParams) {
    factories.push(`
const validateParams = (endpoint: any) =>
  validator('param', async (params, c) => {
    if (!endpoint.input?.params) return undefined;
    const parsed = await Endpoint.validate(endpoint.input.params, params);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });`);
  }

  return factories.join('\n');
}

/**
 * Generate validator references for an endpoint
 */
function generateValidators(
  exportName: string,
  features: EndpointFeatures,
): string {
  const validators: string[] = [];

  if (features.hasBodyValidation) {
    validators.push(`validateBody(${exportName})`);
  }

  if (features.hasQueryValidation) {
    validators.push(`validateQuery(${exportName})`);
  }

  if (features.hasParamValidation) {
    validators.push(`validateParams(${exportName})`);
  }

  // Add trailing comma if there are validators (needed before the handler function)
  return validators.length > 0
    ? '\n    ' + validators.join(',\n    ') + ','
    : '';
}

/**
 * Generate a minimal handler (near-raw-Hono performance)
 *
 * Used for: Health checks, public endpoints with no services
 */
export function generateMinimalHandler(analysis: EndpointAnalysis): string {
  const { exportName, features } = analysis;
  const method = analysis.method.toLowerCase();

  const validators = generateValidators(exportName, features);
  const hasValidators = validators.length > 0;

  // For truly minimal endpoints (no validation), generate inline handler
  if (!hasValidators && !features.hasOutputValidation) {
    return `
  // Minimal handler: ${analysis.route} (${analysis.method})
  app.${method}('${analysis.route}', async (c) => {
    const result = await ${exportName}.handler(
      {
        services: {},
        logger,
        body: undefined,
        query: undefined,
        params: undefined,
        session: undefined,
        header: Endpoint.createHeaders(c.req.header()),
        cookie: Endpoint.createCookies(c.req.header().cookie),
        auditor: undefined,
        db: undefined,
      } as any,
      { getMetadata: () => ({}) } as any,
    );
    return c.json(result, ${exportName}.status as any);
  });`;
  }

  // With validation but still minimal
  return `
  // Minimal handler with validation: ${analysis.route} (${analysis.method})
  app.${method}('${analysis.route}',${validators}
    async (c) => {
      const result = await ${exportName}.handler(
        {
          services: {},
          logger,
          body: ${features.hasBodyValidation ? "(c.req.valid as any)('json')" : 'undefined'},
          query: ${features.hasQueryValidation ? "(c.req.valid as any)('query')" : 'undefined'},
          params: ${features.hasParamValidation ? "(c.req.valid as any)('param')" : 'undefined'},
          session: undefined,
          header: Endpoint.createHeaders(c.req.header()),
          cookie: Endpoint.createCookies(c.req.header().cookie),
          auditor: undefined,
          db: undefined,
        } as any,
        { getMetadata: () => ({}) } as any,
      );
      ${
        features.hasOutputValidation
          ? `const output = await ${exportName}.parseOutput(result);
      return c.json(output, ${exportName}.status as any);`
          : `return c.json(result, ${exportName}.status as any);`
      }
    }
  );`;
}

/**
 * Generate a standard handler (auth and/or services)
 *
 * Used for: Authenticated endpoints, endpoints with services
 */
export function generateStandardHandler(analysis: EndpointAnalysis): string {
  const { exportName, features } = analysis;
  const method = analysis.method.toLowerCase();

  const validators = generateValidators(exportName, features);

  // Build service resolution code
  let serviceResolution = '';
  if (features.hasServices || features.hasDatabase) {
    serviceResolution = `
      const services = await serviceDiscovery.register(${exportName}.services);
      ${
        features.hasDatabase
          ? `const db = ${exportName}.databaseService
        ? (await serviceDiscovery.register([${exportName}.databaseService]) as any)[${exportName}.databaseService.serviceName]
        : undefined;`
          : 'const db = undefined;'
      }`;
  } else {
    serviceResolution = `
      const services = {};
      const db = undefined;`;
  }

  // Build auth code
  let authCode = '';
  if (features.hasAuth) {
    authCode = `
      // Authentication
      const session = await ${exportName}.getSession({
        services,
        logger,
        header,
        cookie,
        ...(db !== undefined && { db }),
      } as any);

      const isAuthorized = await ${exportName}.authorize({
        header,
        cookie,
        services,
        logger,
        session,
      } as any);

      if (!isAuthorized) {
        return c.json({ error: 'Unauthorized' }, 401);
      }`;
  }

  // Build event publishing code
  let eventCode = '';
  if (features.hasEvents) {
    eventCode = `
      // Publish events on success
      if (Endpoint.isSuccessStatus(${exportName}.status)) {
        await (publishConstructEvents as any)(
          ${exportName},
          result,
          serviceDiscovery,
          logger,
        );
      }`;
  }

  return `
  // Standard handler: ${analysis.route} (${analysis.method})
  app.${method}('${analysis.route}',${validators}
    async (c) => {
      const headerValues = c.req.header();
      const header = Endpoint.createHeaders(headerValues);
      const cookie = Endpoint.createCookies(headerValues.cookie);
${serviceResolution}
${authCode}

      const responseBuilder = new ResponseBuilder();
      const result = await ${exportName}.handler(
        {
          services,
          logger,
          body: ${features.hasBodyValidation ? "(c.req.valid as any)('json')" : 'undefined'},
          query: ${features.hasQueryValidation ? "(c.req.valid as any)('query')" : 'undefined'},
          params: ${features.hasParamValidation ? "(c.req.valid as any)('param')" : 'undefined'},
          session: ${features.hasAuth ? 'session' : 'undefined'},
          header,
          cookie,
          auditor: undefined,
          db,
        } as any,
        responseBuilder,
      );

      let data = result;
      let metadata = responseBuilder.getMetadata();

      if (Endpoint.hasMetadata(result)) {
        data = result.data;
        metadata = result.metadata;
      }

      ${
        features.hasOutputValidation
          ? `const output = ${exportName}.outputSchema
        ? await ${exportName}.parseOutput(data)
        : data;`
          : 'const output = data;'
      }
${eventCode}

      const status = (metadata.status ?? ${exportName}.status) as any;
      return c.json(output, status);
    }
  );`;
}

/**
 * Generate setup function that uses HonoEndpoint.addRoutes for full-featured endpoints
 * but generates optimized inline handlers for minimal/standard endpoints
 */
export function generateOptimizedSetupFunction(
  analyses: EndpointAnalysis[],
  _allExportNames: string[],
): string {
  const minimalEndpoints = analyses.filter((a) => a.tier === 'minimal');
  const standardEndpoints = analyses.filter((a) => a.tier === 'standard');
  const fullEndpoints = analyses.filter((a) => a.tier === 'full');

  // Generate inline handlers for minimal and standard endpoints
  const minimalHandlers = minimalEndpoints
    .map((a) => generateMinimalHandler(a))
    .join('\n');

  const standardHandlers = standardEndpoints
    .map((a) => generateStandardHandler(a))
    .join('\n');

  // Full endpoints use HonoEndpoint.addRoutes
  const fullEndpointNames = fullEndpoints.map((a) => a.exportName);

  const fullEndpointsSetup =
    fullEndpointNames.length > 0
      ? `
  // Full-featured endpoints use HonoEndpoint.addRoutes
  const fullEndpoints = [${fullEndpointNames.join(', ')}];
  HonoEndpoint.addRoutes(fullEndpoints, serviceDiscovery, app, openApiOptions);`
      : '';

  // Add HonoEndpoint import only if needed
  const honoEndpointImport =
    fullEndpointNames.length > 0
      ? `import { HonoEndpoint } from '@geekmidas/constructs/hono';`
      : '';

  // Only generate openApiOptions if we have full endpoints that need it
  const openApiOptionsDecl =
    fullEndpointNames.length > 0
      ? `
  const openApiOptions: any = enableOpenApi ? {
    docsPath: '/__docs',
    openApiOptions: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Generated API documentation'
    }
  } : { docsPath: false };`
      : '';

  return `${honoEndpointImport}

export async function setupEndpoints(
  app: Hono,
  envParser: EnvironmentParser<any>,
  logger: Logger,
  enableOpenApi: boolean = false,
): Promise<void> {
  const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);
${openApiOptionsDecl}

  // ============================================
  // Minimal handlers (${minimalEndpoints.length} endpoints)
  // Near-raw-Hono performance
  // ============================================
${minimalHandlers}

  // ============================================
  // Standard handlers (${standardEndpoints.length} endpoints)
  // Auth and/or services
  // ============================================
${standardHandlers}
${fullEndpointsSetup}

  // Add Swagger UI if OpenAPI is enabled
  if (enableOpenApi) {
    try {
      const { swaggerUI } = await import('@hono/swagger-ui');
      app.get('/__docs/ui', swaggerUI({ url: '/__docs' }));
    } catch {
      // @hono/swagger-ui not installed, skip Swagger UI
    }
  }
}`;
}

/**
 * Generate complete optimized endpoints file
 */
export function generateOptimizedEndpointsFile(
  analyses: EndpointAnalysis[],
  endpointImports: string,
  allExportNames: string[],
): string {
  const imports = generateOptimizedImports(analyses);
  const validatorFactories = generateValidatorFactories(analyses);
  const setupFunction = generateOptimizedSetupFunction(
    analyses,
    allExportNames,
  );

  return `/**
 * Generated optimized endpoints file
 *
 * Build-time optimization tiers:
 * - minimal: ${analyses.filter((a) => a.tier === 'minimal').length} endpoints (near-raw-Hono)
 * - standard: ${analyses.filter((a) => a.tier === 'standard').length} endpoints (auth/services)
 * - full: ${analyses.filter((a) => a.tier === 'full').length} endpoints (audits/rls/rate-limit)
 */
${imports}
${endpointImports}
${validatorFactories}

${setupFunction}
`;
}

// ============================================================================
// Multi-File Generation (Split by Tier)
// ============================================================================

/**
 * Generate validators.ts - Shared validator middleware factories
 */
function generateValidatorsFile(analyses: EndpointAnalysis[]): string {
  const needsBody = analyses.some((a) => a.features.hasBodyValidation);
  const needsQuery = analyses.some((a) => a.features.hasQueryValidation);
  const needsParams = analyses.some((a) => a.features.hasParamValidation);

  if (!needsBody && !needsQuery && !needsParams) {
    return `// No validators needed for this build\nexport {};\n`;
  }

  const exports: string[] = [];
  const factories: string[] = [];

  if (needsBody) {
    exports.push('validateBody');
    factories.push(`
export const validateBody = (endpoint: any) =>
  validator('json', async (value, c) => {
    if (!endpoint.input?.body) return undefined;
    const parsed = await Endpoint.validate(endpoint.input.body, value);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });`);
  }

  if (needsQuery) {
    exports.push('validateQuery');
    factories.push(`
export const validateQuery = (endpoint: any) =>
  validator('query', async (_, c) => {
    if (!endpoint.input?.query) return undefined;
    const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = await Endpoint.validate(endpoint.input.query, rawQuery);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });`);
  }

  if (needsParams) {
    exports.push('validateParams');
    factories.push(`
export const validateParams = (endpoint: any) =>
  validator('param', async (params, c) => {
    if (!endpoint.input?.params) return undefined;
    const parsed = await Endpoint.validate(endpoint.input.params, params);
    if (parsed.issues) return c.json(parsed.issues, 422);
    return parsed.value;
  });`);
  }

  return `/**
 * Generated validator middleware factories
 * Shared across all endpoint tiers that need validation
 */
import { validator } from 'hono/validator';
import { Endpoint } from '@geekmidas/constructs/endpoints';
${factories.join('\n')}
`;
}

/**
 * Generate minimal.ts - Minimal tier handlers
 */
function generateMinimalFile(
  analyses: EndpointAnalysis[],
  endpointImports: EndpointImportInfo[],
): string {
  const minimalEndpoints = analyses.filter((a) => a.tier === 'minimal');

  if (minimalEndpoints.length === 0) {
    return `// No minimal-tier endpoints in this build
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';

export function setupMinimalEndpoints(
  _app: Hono,
  _logger: Logger,
): void {
  // No minimal endpoints
}
`;
  }

  const minimalExportNames = minimalEndpoints.map((a) => a.exportName);
  const relevantImports = endpointImports.filter((i) =>
    minimalExportNames.includes(i.exportName),
  );

  const importStatements = relevantImports
    .map((i) => `import { ${i.exportName} } from '${i.importPath}';`)
    .join('\n');

  const needsValidators = minimalEndpoints.some(
    (a) =>
      a.features.hasBodyValidation ||
      a.features.hasQueryValidation ||
      a.features.hasParamValidation,
  );

  const validatorImport = needsValidators
    ? generateValidatorImports(minimalEndpoints)
    : '';

  const handlers = minimalEndpoints
    .map((a) => generateMinimalHandler(a))
    .join('\n');

  return `/**
 * Minimal-tier endpoint handlers (${minimalEndpoints.length} endpoints)
 * Near-raw-Hono performance - no auth, no services, no complex features
 */
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import { Endpoint } from '@geekmidas/constructs/endpoints';
${validatorImport}
${importStatements}

export function setupMinimalEndpoints(
  app: Hono,
  logger: Logger,
): void {
${handlers}
}
`;
}

/**
 * Generate standard.ts - Standard tier handlers
 */
function generateStandardFile(
  analyses: EndpointAnalysis[],
  endpointImports: EndpointImportInfo[],
): string {
  const standardEndpoints = analyses.filter((a) => a.tier === 'standard');

  if (standardEndpoints.length === 0) {
    return `// No standard-tier endpoints in this build
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import type { ServiceDiscovery } from '@geekmidas/services';

export function setupStandardEndpoints(
  _app: Hono,
  _serviceDiscovery: ServiceDiscovery<any, any>,
  _logger: Logger,
): void {
  // No standard endpoints
}
`;
  }

  const standardExportNames = standardEndpoints.map((a) => a.exportName);
  const relevantImports = endpointImports.filter((i) =>
    standardExportNames.includes(i.exportName),
  );

  const importStatements = relevantImports
    .map((i) => `import { ${i.exportName} } from '${i.importPath}';`)
    .join('\n');

  const needsValidators = standardEndpoints.some(
    (a) =>
      a.features.hasBodyValidation ||
      a.features.hasQueryValidation ||
      a.features.hasParamValidation,
  );

  const validatorImport = needsValidators
    ? generateValidatorImports(standardEndpoints)
    : '';

  const needsEvents = standardEndpoints.some((a) => a.features.hasEvents);
  const eventsImport = needsEvents
    ? `import { publishConstructEvents } from '@geekmidas/constructs/endpoints';`
    : '';

  const handlers = standardEndpoints
    .map((a) => generateStandardHandler(a))
    .join('\n');

  return `/**
 * Standard-tier endpoint handlers (${standardEndpoints.length} endpoints)
 * Auth and/or services enabled, but no complex features like audits/RLS
 */
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import type { ServiceDiscovery } from '@geekmidas/services';
import { Endpoint, ResponseBuilder } from '@geekmidas/constructs/endpoints';
${eventsImport}
${validatorImport}
${importStatements}

export function setupStandardEndpoints(
  app: Hono,
  serviceDiscovery: ServiceDiscovery<any, any>,
  logger: Logger,
): void {
${handlers}
}
`;
}

/**
 * Generate full.ts - Full tier handlers (uses HonoEndpoint.addRoutes)
 */
function generateFullFile(
  analyses: EndpointAnalysis[],
  endpointImports: EndpointImportInfo[],
): string {
  const fullEndpoints = analyses.filter((a) => a.tier === 'full');

  if (fullEndpoints.length === 0) {
    return `// No full-tier endpoints in this build
import type { Hono } from 'hono';
import type { ServiceDiscovery } from '@geekmidas/services';

export function setupFullEndpoints(
  _app: Hono,
  _serviceDiscovery: ServiceDiscovery<any, any>,
  _enableOpenApi: boolean,
): void {
  // No full endpoints
}
`;
  }

  const fullExportNames = fullEndpoints.map((a) => a.exportName);
  const relevantImports = endpointImports.filter((i) =>
    fullExportNames.includes(i.exportName),
  );

  const importStatements = relevantImports
    .map((i) => `import { ${i.exportName} } from '${i.importPath}';`)
    .join('\n');

  return `/**
 * Full-tier endpoint handlers (${fullEndpoints.length} endpoints)
 * Complex features: audits, RLS, rate limiting
 * Uses HonoEndpoint.addRoutes for full feature support
 */
import type { Hono } from 'hono';
import type { ServiceDiscovery } from '@geekmidas/services';
import { HonoEndpoint } from '@geekmidas/constructs/hono';
${importStatements}

const fullEndpoints = [${fullExportNames.join(', ')}];

export function setupFullEndpoints(
  app: Hono,
  serviceDiscovery: ServiceDiscovery<any, any>,
  enableOpenApi: boolean,
): void {
  const openApiOptions: any = enableOpenApi ? {
    docsPath: '/__docs',
    openApiOptions: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Generated API documentation'
    }
  } : { docsPath: false };

  HonoEndpoint.addRoutes(fullEndpoints as any, serviceDiscovery, app, openApiOptions);
}
`;
}

/**
 * Generate index.ts - Main entry point
 */
function generateIndexFile(analyses: EndpointAnalysis[]): string {
  const minimalCount = analyses.filter((a) => a.tier === 'minimal').length;
  const standardCount = analyses.filter((a) => a.tier === 'standard').length;
  const fullCount = analyses.filter((a) => a.tier === 'full').length;

  return `/**
 * Generated optimized endpoints
 *
 * Build-time optimization tiers:
 * - minimal: ${minimalCount} endpoints (near-raw-Hono)
 * - standard: ${standardCount} endpoints (auth/services)
 * - full: ${fullCount} endpoints (audits/rls/rate-limit)
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Hono } from 'hono';
import { ServiceDiscovery } from '@geekmidas/services';
import { setupMinimalEndpoints } from './minimal.js';
import { setupStandardEndpoints } from './standard.js';
import { setupFullEndpoints } from './full.js';

export async function setupEndpoints(
  app: Hono,
  envParser: EnvironmentParser<any>,
  logger: Logger,
  enableOpenApi: boolean = false,
): Promise<void> {
  const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);

  // Minimal handlers (${minimalCount} endpoints) - near-raw-Hono performance
  setupMinimalEndpoints(app, logger);

  // Standard handlers (${standardCount} endpoints) - auth/services
  setupStandardEndpoints(app, serviceDiscovery, logger);

  // Full handlers (${fullCount} endpoints) - audits/rls/rate-limit
  setupFullEndpoints(app, serviceDiscovery, enableOpenApi);

  // Add Swagger UI if OpenAPI is enabled
  if (enableOpenApi) {
    try {
      const { swaggerUI } = await import('@hono/swagger-ui');
      app.get('/__docs/ui', swaggerUI({ url: '/__docs' }));
    } catch {
      // @hono/swagger-ui not installed, skip Swagger UI
    }
  }
}
`;
}

/**
 * Generate validator imports based on what's needed
 */
function generateValidatorImports(analyses: EndpointAnalysis[]): string {
  const needsBody = analyses.some((a) => a.features.hasBodyValidation);
  const needsQuery = analyses.some((a) => a.features.hasQueryValidation);
  const needsParams = analyses.some((a) => a.features.hasParamValidation);

  const imports: string[] = [];
  if (needsBody) imports.push('validateBody');
  if (needsQuery) imports.push('validateQuery');
  if (needsParams) imports.push('validateParams');

  if (imports.length === 0) return '';
  return `import { ${imports.join(', ')} } from './validators.js';`;
}

/**
 * Generate all endpoint files split by tier (flat structure)
 */
export function generateEndpointFilesByTier(
  analyses: EndpointAnalysis[],
  endpointImports: EndpointImportInfo[],
): GeneratedEndpointFiles {
  return {
    'validators.ts': generateValidatorsFile(analyses),
    'minimal.ts': generateMinimalFile(analyses, endpointImports),
    'standard.ts': generateStandardFile(analyses, endpointImports),
    'full.ts': generateFullFile(analyses, endpointImports),
    'index.ts': generateIndexFile(analyses),
  };
}

// ============================================================================
// Per-Endpoint File Generation (Nested Folder Structure)
// ============================================================================

/**
 * Generate a standalone minimal endpoint file
 */
function generateMinimalEndpointFile(
  analysis: EndpointAnalysis,
  endpointImport: EndpointImportInfo,
): string {
  const { exportName, features } = analysis;

  const needsValidators =
    features.hasBodyValidation ||
    features.hasQueryValidation ||
    features.hasParamValidation;

  const validatorImport = needsValidators
    ? generateValidatorImportsForEndpoint(analysis)
    : '';

  const handler = generateMinimalHandler(analysis);

  return `/**
 * Minimal endpoint: ${analysis.route} (${analysis.method})
 * Near-raw-Hono performance
 */
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import { Endpoint } from '@geekmidas/constructs/endpoints';
${validatorImport}
import { ${exportName} } from '${endpointImport.importPath}';

export function setup${capitalize(exportName)}(
  app: Hono,
  logger: Logger,
): void {
${handler}
}
`;
}

/**
 * Generate a standalone standard endpoint file
 */
function generateStandardEndpointFile(
  analysis: EndpointAnalysis,
  endpointImport: EndpointImportInfo,
): string {
  const { exportName, features } = analysis;

  const needsValidators =
    features.hasBodyValidation ||
    features.hasQueryValidation ||
    features.hasParamValidation;

  const validatorImport = needsValidators
    ? generateValidatorImportsForEndpoint(analysis)
    : '';

  const eventsImport = features.hasEvents
    ? `import { publishConstructEvents } from '@geekmidas/constructs/endpoints';`
    : '';

  const handler = generateStandardHandler(analysis);

  return `/**
 * Standard endpoint: ${analysis.route} (${analysis.method})
 * Auth and/or services enabled
 */
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import type { ServiceDiscovery } from '@geekmidas/services';
import { Endpoint, ResponseBuilder } from '@geekmidas/constructs/endpoints';
${eventsImport}
${validatorImport}
import { ${exportName} } from '${endpointImport.importPath}';

export function setup${capitalize(exportName)}(
  app: Hono,
  serviceDiscovery: ServiceDiscovery<any, any>,
  logger: Logger,
): void {
${handler}
}
`;
}

/**
 * Generate a standalone full endpoint file
 */
function generateFullEndpointFile(
  analysis: EndpointAnalysis,
  endpointImport: EndpointImportInfo,
): string {
  const { exportName } = analysis;

  return `/**
 * Full endpoint: ${analysis.route} (${analysis.method})
 * Complex features: audits, RLS, rate limiting
 */
import type { Hono } from 'hono';
import type { ServiceDiscovery } from '@geekmidas/services';
import { HonoEndpoint } from '@geekmidas/constructs/hono';
import { ${exportName} } from '${endpointImport.importPath}';

export function setup${capitalize(exportName)}(
  app: Hono,
  serviceDiscovery: ServiceDiscovery<any, any>,
  openApiOptions: any,
): void {
  HonoEndpoint.addRoutes([${exportName}] as any, serviceDiscovery, app, openApiOptions);
}
`;
}

/**
 * Generate tier index file that imports and calls all endpoint setup functions
 */
function generateTierIndexFile(
  tier: 'minimal' | 'standard' | 'full',
  analyses: EndpointAnalysis[],
): string {
  const tierEndpoints = analyses.filter((a) => a.tier === tier);

  if (tierEndpoints.length === 0) {
    if (tier === 'minimal') {
      return `// No minimal-tier endpoints in this build
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';

export function setupMinimalEndpoints(
  _app: Hono,
  _logger: Logger,
): void {
  // No minimal endpoints
}
`;
    }
    if (tier === 'standard') {
      return `// No standard-tier endpoints in this build
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import type { ServiceDiscovery } from '@geekmidas/services';

export function setupStandardEndpoints(
  _app: Hono,
  _serviceDiscovery: ServiceDiscovery<any, any>,
  _logger: Logger,
): void {
  // No standard endpoints
}
`;
    }
    // full
    return `// No full-tier endpoints in this build
import type { Hono } from 'hono';
import type { ServiceDiscovery } from '@geekmidas/services';

export function setupFullEndpoints(
  _app: Hono,
  _serviceDiscovery: ServiceDiscovery<any, any>,
  _enableOpenApi: boolean,
): void {
  // No full endpoints
}
`;
  }

  const imports = tierEndpoints
    .map(
      (a) =>
        `import { setup${capitalize(a.exportName)} } from './${a.exportName}.js';`,
    )
    .join('\n');

  if (tier === 'minimal') {
    const calls = tierEndpoints
      .map((a) => `  setup${capitalize(a.exportName)}(app, logger);`)
      .join('\n');

    return `/**
 * Minimal-tier endpoint index (${tierEndpoints.length} endpoints)
 * Near-raw-Hono performance
 */
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
${imports}

export function setupMinimalEndpoints(
  app: Hono,
  logger: Logger,
): void {
${calls}
}
`;
  }

  if (tier === 'standard') {
    const calls = tierEndpoints
      .map(
        (a) =>
          `  setup${capitalize(a.exportName)}(app, serviceDiscovery, logger);`,
      )
      .join('\n');

    return `/**
 * Standard-tier endpoint index (${tierEndpoints.length} endpoints)
 * Auth and/or services enabled
 */
import type { Hono } from 'hono';
import type { Logger } from '@geekmidas/logger';
import type { ServiceDiscovery } from '@geekmidas/services';
${imports}

export function setupStandardEndpoints(
  app: Hono,
  serviceDiscovery: ServiceDiscovery<any, any>,
  logger: Logger,
): void {
${calls}
}
`;
  }

  // full
  const calls = tierEndpoints
    .map(
      (a) =>
        `  setup${capitalize(a.exportName)}(app, serviceDiscovery, openApiOptions);`,
    )
    .join('\n');

  return `/**
 * Full-tier endpoint index (${tierEndpoints.length} endpoints)
 * Complex features: audits, RLS, rate limiting
 */
import type { Hono } from 'hono';
import type { ServiceDiscovery } from '@geekmidas/services';
${imports}

export function setupFullEndpoints(
  app: Hono,
  serviceDiscovery: ServiceDiscovery<any, any>,
  enableOpenApi: boolean,
): void {
  const openApiOptions: any = enableOpenApi ? {
    docsPath: '/__docs',
    openApiOptions: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Generated API documentation'
    }
  } : { docsPath: false };

${calls}
}
`;
}

/**
 * Generate validator imports for a single endpoint
 */
function generateValidatorImportsForEndpoint(
  analysis: EndpointAnalysis,
): string {
  const imports: string[] = [];
  if (analysis.features.hasBodyValidation) imports.push('validateBody');
  if (analysis.features.hasQueryValidation) imports.push('validateQuery');
  if (analysis.features.hasParamValidation) imports.push('validateParams');

  if (imports.length === 0) return '';
  return `import { ${imports.join(', ')} } from '../validators.js';`;
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generate all endpoint files with nested folder structure (per-endpoint files)
 */
export function generateEndpointFilesNested(
  analyses: EndpointAnalysis[],
  endpointImports: EndpointImportInfo[],
): GeneratedEndpointFilesNested {
  const files: GeneratedEndpointFilesNested = {
    'validators.ts': generateValidatorsFile(analyses),
    'minimal/index.ts': generateTierIndexFile('minimal', analyses),
    'standard/index.ts': generateTierIndexFile('standard', analyses),
    'full/index.ts': generateTierIndexFile('full', analyses),
    'index.ts': generateNestedIndexFile(analyses),
  };

  // Generate individual endpoint files
  for (const analysis of analyses) {
    const endpointImport = endpointImports.find(
      (i) => i.exportName === analysis.exportName,
    );
    if (!endpointImport) continue;

    const fileName = `${analysis.tier}/${analysis.exportName}.ts`;

    switch (analysis.tier) {
      case 'minimal':
        files[fileName] = generateMinimalEndpointFile(analysis, endpointImport);
        break;
      case 'standard':
        files[fileName] = generateStandardEndpointFile(
          analysis,
          endpointImport,
        );
        break;
      case 'full':
        files[fileName] = generateFullEndpointFile(analysis, endpointImport);
        break;
    }
  }

  return files;
}

/**
 * Generate index.ts for nested structure
 */
function generateNestedIndexFile(analyses: EndpointAnalysis[]): string {
  const minimalCount = analyses.filter((a) => a.tier === 'minimal').length;
  const standardCount = analyses.filter((a) => a.tier === 'standard').length;
  const fullCount = analyses.filter((a) => a.tier === 'full').length;

  return `/**
 * Generated optimized endpoints
 *
 * Build-time optimization tiers:
 * - minimal: ${minimalCount} endpoints (near-raw-Hono)
 * - standard: ${standardCount} endpoints (auth/services)
 * - full: ${fullCount} endpoints (audits/rls/rate-limit)
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Hono } from 'hono';
import { ServiceDiscovery } from '@geekmidas/services';
import { setupMinimalEndpoints } from './minimal/index.js';
import { setupStandardEndpoints } from './standard/index.js';
import { setupFullEndpoints } from './full/index.js';

export async function setupEndpoints(
  app: Hono,
  envParser: EnvironmentParser<any>,
  logger: Logger,
  enableOpenApi: boolean = false,
): Promise<void> {
  const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);

  // Minimal handlers (${minimalCount} endpoints) - near-raw-Hono performance
  setupMinimalEndpoints(app, logger);

  // Standard handlers (${standardCount} endpoints) - auth/services
  setupStandardEndpoints(app, serviceDiscovery, logger);

  // Full handlers (${fullCount} endpoints) - audits/rls/rate-limit
  setupFullEndpoints(app, serviceDiscovery, enableOpenApi);

  // Add Swagger UI if OpenAPI is enabled
  if (enableOpenApi) {
    try {
      const { swaggerUI } = await import('@hono/swagger-ui');
      app.get('/__docs/ui', swaggerUI({ url: '/__docs' }));
    } catch {
      // @hono/swagger-ui not installed, skip Swagger UI
    }
  }
}
`;
}
