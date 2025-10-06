import type { 
  MainProvider, 
  LegacyProvider, 
  BuildOptions, 
  GkmConfig,
  ProvidersConfig,
  AWSApiGatewayConfig,
  AWSLambdaConfig,
  ServerConfig 
} from '../types';

export interface ResolvedProviders {
  providers: LegacyProvider[];
  enableOpenApi: boolean;
}

/**
 * Resolves provider configuration from the new simplified system
 * to the internal legacy format for backward compatibility
 */
export function resolveProviders(
  config: GkmConfig,
  options: BuildOptions,
): ResolvedProviders {
  const providers: LegacyProvider[] = [];
  let enableOpenApi = options.enableOpenApi || false;

  // Handle legacy providers option (deprecated)
  if (options.providers) {
    return {
      providers: options.providers,
      enableOpenApi,
    };
  }

  // Handle new provider option
  if (options.provider) {
    const resolvedProviders = resolveMainProvider(
      options.provider,
      config.providers,
    );
    providers.push(...resolvedProviders.providers);
    enableOpenApi = resolvedProviders.enableOpenApi || enableOpenApi;
  }
  // Default: build all configured providers
  else if (config.providers) {
    const resolvedProviders = resolveAllConfiguredProviders(config.providers);
    providers.push(...resolvedProviders.providers);
    enableOpenApi = resolvedProviders.enableOpenApi || enableOpenApi;
  }
  // Fallback: use default AWS configuration
  else {
    providers.push('aws-apigatewayv2', 'aws-lambda');
  }

  return {
    providers: [...new Set(providers)], // Remove duplicates
    enableOpenApi,
  };
}

function resolveMainProvider(
  mainProvider: MainProvider,
  providersConfig?: ProvidersConfig,
): ResolvedProviders {
  const providers: LegacyProvider[] = [];
  let enableOpenApi = false;

  if (mainProvider === 'aws') {
    const awsConfig = providersConfig?.aws;
    
    // Resolve API Gateway providers
    if (awsConfig?.apiGateway) {
      if (isEnabled(awsConfig.apiGateway.v1)) {
        providers.push('aws-apigatewayv1');
      }
      if (isEnabled(awsConfig.apiGateway.v2)) {
        providers.push('aws-apigatewayv2');
      }
    } else {
      // Default: enable v2 if no specific config
      providers.push('aws-apigatewayv2');
    }

    // Resolve Lambda providers
    if (awsConfig?.lambda) {
      if (isEnabled(awsConfig.lambda.functions) || isEnabled(awsConfig.lambda.crons)) {
        providers.push('aws-lambda');
      }
    } else {
      // Default: enable lambda if no specific config
      providers.push('aws-lambda');
    }
  } else if (mainProvider === 'server') {
    providers.push('server');
    const serverConfig = providersConfig?.server;
    
    if (typeof serverConfig === 'object' && serverConfig?.enableOpenApi) {
      enableOpenApi = true;
    }
  }

  return { providers, enableOpenApi };
}

function resolveAllConfiguredProviders(
  providersConfig: ProvidersConfig,
): ResolvedProviders {
  const providers: LegacyProvider[] = [];
  let enableOpenApi = false;

  // AWS providers
  if (providersConfig.aws) {
    const awsProviders = resolveMainProvider('aws', providersConfig);
    providers.push(...awsProviders.providers);
  }

  // Server provider
  if (providersConfig.server && isEnabled(providersConfig.server)) {
    providers.push('server');
    if (typeof providersConfig.server === 'object' && providersConfig.server.enableOpenApi) {
      enableOpenApi = true;
    }
  }

  return { providers, enableOpenApi };
}

function isEnabled(config: boolean | AWSApiGatewayConfig | AWSLambdaConfig | ServerConfig | undefined): boolean {
  if (config === undefined) return false;
  if (typeof config === 'boolean') return config;
  return config.enabled !== false; // Default to true if enabled is not explicitly false
}

/**
 * Gets configuration for a specific AWS service
 */
export function getAWSServiceConfig<T extends AWSApiGatewayConfig | AWSLambdaConfig>(
  config: GkmConfig,
  service: 'apiGateway' | 'lambda',
  subService?: 'v1' | 'v2' | 'functions' | 'crons',
): T | undefined {
  const awsConfig = config.providers?.aws;
  if (!awsConfig) return undefined;

  if (service === 'apiGateway' && awsConfig.apiGateway) {
    const apiConfig = subService ? awsConfig.apiGateway[subService as 'v1' | 'v2'] : undefined;
    return typeof apiConfig === 'object' ? (apiConfig as T) : undefined;
  }

  if (service === 'lambda' && awsConfig.lambda) {
    const lambdaConfig = subService ? awsConfig.lambda[subService as 'functions' | 'crons'] : undefined;
    return typeof lambdaConfig === 'object' ? (lambdaConfig as T) : undefined;
  }

  return undefined;
}

/**
 * Gets server configuration
 */
export function getServerConfig(config: GkmConfig): ServerConfig | undefined {
  const serverConfig = config.providers?.server;
  return typeof serverConfig === 'object' ? serverConfig : undefined;
}