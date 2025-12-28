/**
 * OpenAPI 3.1 compliant security scheme definition.
 * @see https://spec.openapis.org/oas/v3.1.0#security-scheme-object
 */
export interface SecurityScheme {
  /** The type of the security scheme */
  type: 'apiKey' | 'http' | 'mutualTLS' | 'oauth2' | 'openIdConnect';
  /** A description for security scheme */
  description?: string;
  /** Required for apiKey. The name of the header, query or cookie parameter */
  name?: string;
  /** Required for apiKey. The location of the API key */
  in?: 'query' | 'header' | 'cookie';
  /** Required for http. The name of the HTTP Authorization scheme (e.g., 'bearer') */
  scheme?: string;
  /** Optional for http bearer. A hint to the format of the bearer token */
  bearerFormat?: string;
  /** Required for oauth2. An object containing configuration for the flow types */
  flows?: OAuthFlows;
  /** Required for openIdConnect. The URL to discover OAuth2 configuration */
  openIdConnectUrl?: string;
  /** Vendor extensions (e.g., x-amazon-apigateway-authtype) */
  [key: `x-${string}`]: unknown;
}

/**
 * OAuth2 flow configuration
 */
export interface OAuthFlows {
  implicit?: OAuthFlow;
  password?: OAuthFlow;
  clientCredentials?: OAuthFlow;
  authorizationCode?: OAuthFlow;
}

export interface OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

/**
 * Built-in security schemes available by default.
 * Users can use these without defining them via .securitySchemes().
 */
export const BUILT_IN_SECURITY_SCHEMES = {
  jwt: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT Bearer token authentication',
  },
  bearer: {
    type: 'http',
    scheme: 'bearer',
    description: 'Bearer token authentication',
  },
  apiKey: {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description: 'API key authentication via header',
  },
  oauth2: {
    type: 'oauth2',
    flows: {},
    description: 'OAuth 2.0 authentication',
  },
  oidc: {
    type: 'openIdConnect',
    openIdConnectUrl: '',
    description: 'OpenID Connect authentication',
  },
  iam: {
    type: 'apiKey',
    in: 'header',
    name: 'Authorization',
    description: 'AWS IAM Signature Version 4 authentication',
    'x-amazon-apigateway-authtype': 'awsSigv4',
  },
} as const satisfies Record<string, SecurityScheme>;

/** Names of built-in security schemes */
export type BuiltInSecuritySchemeId = keyof typeof BUILT_IN_SECURITY_SCHEMES;

/**
 * Represents an authorizer configuration for endpoints
 */
export interface Authorizer {
  /**
   * Unique identifier for the authorizer
   */
  name: string;
  /**
   * The OpenAPI security scheme definition for this authorizer
   */
  securityScheme?: SecurityScheme;
  /**
   * Type of authorizer (e.g., 'iam', 'jwt', 'custom')
   * @deprecated Use securityScheme.type instead
   */
  type?: string;
  /**
   * Description of what this authorizer does
   * @deprecated Use securityScheme.description instead
   */
  description?: string;
  /**
   * Additional metadata specific to the authorizer type
   * @deprecated Use securityScheme with x-* extensions instead
   */
  metadata?: Record<string, unknown>;
}

/**
 * Helper to create an authorizer configuration
 */
export function createAuthorizer(
  name: string,
  options?: Omit<Authorizer, 'name'>,
): Authorizer {
  return {
    name,
    ...options,
  };
}

/**
 * Check if a name is a built-in security scheme
 */
export function isBuiltInSecurityScheme(
  name: string,
): name is BuiltInSecuritySchemeId {
  return name in BUILT_IN_SECURITY_SCHEMES;
}

/**
 * Get a security scheme by name (built-in or custom)
 */
export function getSecurityScheme(
  name: string,
  customSchemes?: Record<string, SecurityScheme>,
): SecurityScheme | undefined {
  if (customSchemes && name in customSchemes) {
    return customSchemes[name];
  }
  if (isBuiltInSecurityScheme(name)) {
    return BUILT_IN_SECURITY_SCHEMES[name];
  }
  return undefined;
}
