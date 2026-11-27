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
	/** Vendor extensions (e.g., x-usePkce) */
	[key: `x-${string}`]: unknown;
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

/**
 * One way to call an endpoint: the authorizer it accepts and the scopes that
 * authorizer must grant. An endpoint's `security` lists every way; any one of
 * them is enough, as in an OpenAPI security requirement list.
 * @see https://spec.openapis.org/oas/v3.1.0#security-requirement-object
 */
export interface SecurityRequirement {
	authorizer: Authorizer;
	scopes: string[];
}

/**
 * How an endpoint names one authorizer it accepts — bare, or with the scopes
 * a caller's credential must carry: `'session'`, or
 * `{ name: 'oauth', scopes: ['orders:read'] }`.
 */
export type AuthorizerRequirement<TName extends string = string> =
	| TName
	| { name: TName; scopes?: readonly string[] };

/** What `.authorizer(name, options)` takes beside the name. */
export interface AuthorizerOptions {
	/**
	 * The scopes a caller's credential must carry. Documented in the endpoint's
	 * security requirement; checking them is the authorizer's job.
	 */
	scopes?: readonly string[];
}

/** An endpoint, or a factory's default, named an authorizer it was not given. */
export class AuthorizerNotAvailable extends Error {
	constructor(
		readonly authorizer: string,
		readonly available: readonly string[],
	) {
		super(
			`Authorizer "${authorizer}" not found in available authorizers: ${available.join(', ')}. ` +
				"Name one of those, or add it to the surface's `authorizers`.",
		);
		this.name = 'AuthorizerNotAvailable';
	}
}

/**
 * `.authorizers([])`: an endpoint that accepts no authorizer is a public one,
 * which is said with `.authorizer('none')`.
 */
export class NoAuthorizersGiven extends Error {
	constructor(readonly route: string) {
		super(
			`'${route}' was given an empty list of authorizers. Name at least one, ` +
				"or use `.authorizer('none')` for a public endpoint.",
		);
		this.name = 'NoAuthorizersGiven';
	}
}

/**
 * Throws `AuthorizerNotAvailable` unless `name` is one of `available`. A
 * factory that declared no authorizers accepts any name.
 */
export function assertAuthorizerAvailable(
	name: string,
	available: readonly Authorizer[],
): void {
	if (available.length > 0 && !available.some((a) => a.name === name)) {
		throw new AuthorizerNotAvailable(
			name,
			available.map((a) => a.name),
		);
	}
}

/** `'jwt'` or `{ name: 'jwt', scopes }`, as `{ name, scopes }`. */
export function normalizeAuthorizerRequirement(
	requirement: AuthorizerRequirement,
): { name: string; scopes: string[] } {
	return typeof requirement === 'string'
		? { name: requirement, scopes: [] }
		: { name: requirement.name, scopes: [...(requirement.scopes ?? [])] };
}

/**
 * The authorizer a name stands for: the factory's own when it declared one,
 * otherwise one carrying the built-in or custom scheme of that name.
 */
export function resolveAuthorizer(
	name: string,
	available: readonly Authorizer[],
	customSchemes?: Record<string, SecurityScheme>,
): Authorizer {
	return (
		available.find((a) => a.name === name) ?? {
			name,
			securityScheme: getSecurityScheme(name, customSchemes),
		}
	);
}

/**
 * An OAuth 2.0 client-credentials scheme (RFC 6749 §4.4): a service trades
 * its own client id and secret at `tokenUrl` for a token carrying `scopes`.
 *
 * @example
 * ```typescript
 * new RestApi('Api', {
 *   path: 'apps/api',
 *   securitySchemes: {
 *     partners: oauth2ClientCredentials({
 *       tokenUrl: 'https://auth.example.com/oauth/token',
 *       scopes: { 'orders:read': 'Read orders' },
 *     }),
 *   },
 *   authorizers: ['partners'],
 *   defaultAuthorizer: 'none',
 * });
 * ```
 */
export function oauth2ClientCredentials(options: {
	tokenUrl: string;
	/** Every scope the scheme grants, with what it allows. */
	scopes: Record<string, string>;
	refreshUrl?: string;
	description?: string;
}): SecurityScheme {
	return {
		type: 'oauth2',
		...(options.description && { description: options.description }),
		flows: {
			clientCredentials: {
				tokenUrl: options.tokenUrl,
				...(options.refreshUrl && { refreshUrl: options.refreshUrl }),
				scopes: options.scopes,
			},
		},
	};
}

/**
 * An OAuth 2.0 authorization-code scheme, with PKCE (RFC 7636) unless
 * `pkce: false`: a user signs in at `authorizationUrl`, and the app trades
 * the code it gets back at `tokenUrl`.
 *
 * PKCE is written as `x-usePkce: 'SHA-256'` on the flow. OpenAPI has no field
 * for it: PKCE is not a grant of its own but two extra parameters on the
 * authorization-code one, so without the extension a document cannot tell a
 * generated client, or a docs page's "Authorize" button, that the server
 * refuses a code exchange with no `code_verifier`. `x-usePkce` is the
 * extension the documentation tools that support PKCE read (Scalar among
 * them), and every other reader ignores an `x-` field.
 */
export function oauth2AuthorizationCode(options: {
	authorizationUrl: string;
	tokenUrl: string;
	/** Every scope the scheme grants, with what it allows. */
	scopes: Record<string, string>;
	refreshUrl?: string;
	description?: string;
	/** Whether the code exchange requires PKCE with S256. Default `true`. */
	pkce?: boolean;
}): SecurityScheme {
	return {
		type: 'oauth2',
		...(options.description && { description: options.description }),
		flows: {
			authorizationCode: {
				authorizationUrl: options.authorizationUrl,
				tokenUrl: options.tokenUrl,
				...(options.refreshUrl && { refreshUrl: options.refreshUrl }),
				scopes: options.scopes,
				...(options.pkce !== false && { 'x-usePkce': 'SHA-256' }),
			},
		},
	};
}
