/**
 * Handler Templates for Build-Time Code Generation
 *
 * Generates optimized handler code based on endpoint tier:
 * - minimal: Near-raw-Hono performance for simple endpoints
 * - standard: Middleware composition for auth/services
 * - full: Complete handler chain for complex endpoints
 */
import type { EndpointAnalysis, EndpointFeatures } from './endpoint-analyzer';

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
    `import type { Hono, Context } from 'hono';`,
  ];

  if (needsValidator) {
    imports.push(`import { validator } from 'hono/validator';`);
  }

  imports.push(
    `import { Endpoint } from '@geekmidas/constructs/endpoints';`,
  );

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
 * Generate validator code for an endpoint
 */
function generateValidators(
  exportName: string,
  features: EndpointFeatures,
): string {
  const validators: string[] = [];

  if (features.hasBodyValidation) {
    validators.push(`
    validator('json', async (value, c) => {
      if (!${exportName}.input?.body) return undefined;
      const parsed = await Endpoint.validate(${exportName}.input.body, value);
      if (parsed.issues) return c.json(parsed.issues, 422);
      return parsed.value;
    })`);
  }

  if (features.hasQueryValidation) {
    validators.push(`
    validator('query', async (_, c) => {
      if (!${exportName}.input?.query) return undefined;
      const rawQuery = Object.fromEntries(new URL(c.req.url).searchParams);
      const parsed = await Endpoint.validate(${exportName}.input.query, rawQuery);
      if (parsed.issues) return c.json(parsed.issues, 422);
      return parsed.value;
    })`);
  }

  if (features.hasParamValidation) {
    validators.push(`
    validator('param', async (params, c) => {
      if (!${exportName}.input?.params) return undefined;
      const parsed = await Endpoint.validate(${exportName}.input.params, params);
      if (parsed.issues) return c.json(parsed.issues, 422);
      return parsed.value;
    })`);
  }

  return validators.join(',');
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
        ? (await serviceDiscovery.register([${exportName}.databaseService]))[${exportName}.databaseService.serviceName as keyof typeof services]
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
      });

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
        await publishConstructEvents(
          ${exportName} as any,
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

  return `${honoEndpointImport}

export async function setupEndpoints(
  app: Hono,
  envParser: EnvironmentParser<any>,
  logger: Logger,
  enableOpenApi: boolean = false,
): Promise<void> {
  const serviceDiscovery = ServiceDiscovery.getInstance(logger, envParser);

  const openApiOptions: any = enableOpenApi ? {
    docsPath: '/__docs',
    openApiOptions: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Generated API documentation'
    }
  } : { docsPath: false };

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
  const setupFunction = generateOptimizedSetupFunction(analyses, allExportNames);

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

${setupFunction}
`;
}
