/**
 * Endpoint Analyzer for Build-Time Feature Detection
 *
 * Analyzes endpoints at build time to determine their features and assign
 * optimization tiers. This enables generating specialized handler code
 * for maximum performance.
 */
import type { Endpoint } from '@geekmidas/constructs/endpoints';

/**
 * Features detected from an endpoint configuration
 */
export interface EndpointFeatures {
  hasAuth: boolean;
  hasServices: boolean;
  hasDatabase: boolean;
  hasBodyValidation: boolean;
  hasQueryValidation: boolean;
  hasParamValidation: boolean;
  hasAudits: boolean;
  hasEvents: boolean;
  hasRateLimit: boolean;
  hasRls: boolean;
  hasOutputValidation: boolean;
}

/**
 * Optimization tiers based on endpoint complexity
 *
 * - minimal: No auth, no services, no audits, no events - near-raw-Hono performance
 * - standard: Some features enabled - uses middleware composition
 * - full: Complex endpoints with many features - full handler chain
 */
export type EndpointTier = 'minimal' | 'standard' | 'full';

/**
 * Complete analysis of an endpoint for build-time optimization
 */
export interface EndpointAnalysis {
  route: string;
  method: string;
  exportName: string;
  features: EndpointFeatures;
  tier: EndpointTier;
  serviceNames: string[];
  databaseServiceName?: string;
}

/**
 * Analyze an endpoint to extract its features
 */
export function analyzeEndpointFeatures(
  endpoint: Endpoint<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
): EndpointFeatures {
  return {
    hasAuth: !!endpoint.authorizer,
    hasServices: endpoint.services.length > 0,
    hasDatabase: !!endpoint.databaseService,
    hasBodyValidation: !!endpoint.input?.body,
    hasQueryValidation: !!endpoint.input?.query,
    hasParamValidation: !!endpoint.input?.params,
    // Only declarative audits (.audit([...])) require full tier with transaction wrapping
    // Having auditorStorageService just makes auditor available to handler (like other services)
    hasAudits: (endpoint.audits?.length ?? 0) > 0,
    hasEvents: (endpoint.events?.length ?? 0) > 0,
    hasRateLimit: !!endpoint.rateLimit,
    hasRls: !!endpoint.rlsConfig && !endpoint.rlsBypass,
    hasOutputValidation: !!endpoint.outputSchema,
  };
}

/**
 * Determine the optimization tier for an endpoint based on its features
 */
export function determineEndpointTier(features: EndpointFeatures): EndpointTier {
  const {
    hasAuth,
    hasServices,
    hasDatabase,
    hasAudits,
    hasEvents,
    hasRateLimit,
    hasRls,
  } = features;

  // Minimal tier: No complex features
  // These endpoints can use near-raw-Hono handlers
  if (
    !hasAuth &&
    !hasServices &&
    !hasDatabase &&
    !hasAudits &&
    !hasEvents &&
    !hasRateLimit &&
    !hasRls
  ) {
    return 'minimal';
  }

  // Full tier: Has audits, RLS, or rate limiting (complex state management)
  if (hasAudits || hasRls || hasRateLimit) {
    return 'full';
  }

  // Standard tier: Auth and/or services, but no complex state
  return 'standard';
}

/**
 * Perform complete analysis of an endpoint
 */
export function analyzeEndpoint(
  endpoint: Endpoint<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >,
  exportName: string,
): EndpointAnalysis {
  const features = analyzeEndpointFeatures(endpoint);
  const tier = determineEndpointTier(features);

  return {
    route: endpoint.route,
    method: endpoint.method,
    exportName,
    features,
    tier,
    serviceNames: endpoint.services.map((s: { serviceName: string }) => s.serviceName),
    databaseServiceName: endpoint.databaseService?.serviceName,
  };
}

/**
 * Analyze multiple endpoints and return analysis results
 */
export function analyzeEndpoints(
  endpoints: Array<{
    endpoint: Endpoint<
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any
    >;
    exportName: string;
  }>,
): EndpointAnalysis[] {
  return endpoints.map(({ endpoint, exportName }) =>
    analyzeEndpoint(endpoint, exportName),
  );
}

/**
 * Generate a summary of endpoint analysis for logging
 */
export function summarizeAnalysis(analyses: EndpointAnalysis[]): {
  total: number;
  byTier: Record<EndpointTier, number>;
  byFeature: Record<keyof EndpointFeatures, number>;
} {
  const byTier: Record<EndpointTier, number> = {
    minimal: 0,
    standard: 0,
    full: 0,
  };

  const byFeature: Record<keyof EndpointFeatures, number> = {
    hasAuth: 0,
    hasServices: 0,
    hasDatabase: 0,
    hasBodyValidation: 0,
    hasQueryValidation: 0,
    hasParamValidation: 0,
    hasAudits: 0,
    hasEvents: 0,
    hasRateLimit: 0,
    hasRls: 0,
    hasOutputValidation: 0,
  };

  for (const analysis of analyses) {
    byTier[analysis.tier]++;

    for (const [feature, enabled] of Object.entries(analysis.features)) {
      if (enabled) {
        byFeature[feature as keyof EndpointFeatures]++;
      }
    }
  }

  return {
    total: analyses.length,
    byTier,
    byFeature,
  };
}
