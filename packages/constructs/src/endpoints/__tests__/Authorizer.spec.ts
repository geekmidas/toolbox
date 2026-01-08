import { describe, expect, it } from 'vitest';
import {
	type Authorizer,
	BUILT_IN_SECURITY_SCHEMES,
	createAuthorizer,
	getSecurityScheme,
	isBuiltInSecurityScheme,
	type SecurityScheme,
} from '../Authorizer';

describe('Authorizer', () => {
	describe('BUILT_IN_SECURITY_SCHEMES', () => {
		it('should have jwt scheme configured correctly', () => {
			const jwt = BUILT_IN_SECURITY_SCHEMES.jwt;
			expect(jwt.type).toBe('http');
			expect(jwt.scheme).toBe('bearer');
			expect(jwt.bearerFormat).toBe('JWT');
			expect(jwt.description).toBeDefined();
		});

		it('should have bearer scheme configured correctly', () => {
			const bearer = BUILT_IN_SECURITY_SCHEMES.bearer;
			expect(bearer.type).toBe('http');
			expect(bearer.scheme).toBe('bearer');
			expect(bearer.description).toBeDefined();
		});

		it('should have apiKey scheme configured correctly', () => {
			const apiKey = BUILT_IN_SECURITY_SCHEMES.apiKey;
			expect(apiKey.type).toBe('apiKey');
			expect(apiKey.in).toBe('header');
			expect(apiKey.name).toBe('X-API-Key');
			expect(apiKey.description).toBeDefined();
		});

		it('should have oauth2 scheme configured correctly', () => {
			const oauth2 = BUILT_IN_SECURITY_SCHEMES.oauth2;
			expect(oauth2.type).toBe('oauth2');
			expect(oauth2.flows).toBeDefined();
			expect(oauth2.description).toBeDefined();
		});

		it('should have oidc scheme configured correctly', () => {
			const oidc = BUILT_IN_SECURITY_SCHEMES.oidc;
			expect(oidc.type).toBe('openIdConnect');
			expect(oidc.openIdConnectUrl).toBeDefined();
			expect(oidc.description).toBeDefined();
		});

		it('should have iam scheme configured correctly', () => {
			const iam = BUILT_IN_SECURITY_SCHEMES.iam;
			expect(iam.type).toBe('apiKey');
			expect(iam.in).toBe('header');
			expect(iam.name).toBe('Authorization');
			expect(iam['x-amazon-apigateway-authtype']).toBe('awsSigv4');
			expect(iam.description).toBeDefined();
		});
	});

	describe('isBuiltInSecurityScheme', () => {
		it('should return true for built-in scheme names', () => {
			expect(isBuiltInSecurityScheme('jwt')).toBe(true);
			expect(isBuiltInSecurityScheme('bearer')).toBe(true);
			expect(isBuiltInSecurityScheme('apiKey')).toBe(true);
			expect(isBuiltInSecurityScheme('oauth2')).toBe(true);
			expect(isBuiltInSecurityScheme('oidc')).toBe(true);
			expect(isBuiltInSecurityScheme('iam')).toBe(true);
		});

		it('should return false for non-built-in scheme names', () => {
			expect(isBuiltInSecurityScheme('custom')).toBe(false);
			expect(isBuiltInSecurityScheme('myAuth')).toBe(false);
			expect(isBuiltInSecurityScheme('')).toBe(false);
			expect(isBuiltInSecurityScheme('JWT')).toBe(false); // Case sensitive
		});
	});

	describe('createAuthorizer', () => {
		it('should create an authorizer with just a name', () => {
			const authorizer = createAuthorizer('myAuth');
			expect(authorizer.name).toBe('myAuth');
			expect(authorizer.securityScheme).toBeUndefined();
			expect(authorizer.type).toBeUndefined();
		});

		it('should create an authorizer with security scheme', () => {
			const securityScheme: SecurityScheme = {
				type: 'http',
				scheme: 'bearer',
				bearerFormat: 'JWT',
				description: 'Custom JWT auth',
			};

			const authorizer = createAuthorizer('customJwt', { securityScheme });

			expect(authorizer.name).toBe('customJwt');
			expect(authorizer.securityScheme).toEqual(securityScheme);
		});

		it('should create an authorizer with legacy type and description', () => {
			const authorizer = createAuthorizer('legacyAuth', {
				type: 'custom',
				description: 'A legacy authorizer',
				metadata: { key: 'value' },
			});

			expect(authorizer.name).toBe('legacyAuth');
			expect(authorizer.type).toBe('custom');
			expect(authorizer.description).toBe('A legacy authorizer');
			expect(authorizer.metadata).toEqual({ key: 'value' });
		});

		it('should create an authorizer with all options', () => {
			const authorizer: Authorizer = createAuthorizer('fullAuth', {
				securityScheme: {
					type: 'apiKey',
					in: 'header',
					name: 'X-Custom-Auth',
					description: 'Custom API key auth',
				},
				type: 'apiKey',
				description: 'Full authorizer config',
				metadata: { custom: true },
			});

			expect(authorizer.name).toBe('fullAuth');
			expect(authorizer.securityScheme?.type).toBe('apiKey');
			expect(authorizer.securityScheme?.name).toBe('X-Custom-Auth');
			expect(authorizer.type).toBe('apiKey');
			expect(authorizer.description).toBe('Full authorizer config');
			expect(authorizer.metadata).toEqual({ custom: true });
		});
	});

	describe('getSecurityScheme', () => {
		it('should return built-in scheme when no custom schemes provided', () => {
			const jwt = getSecurityScheme('jwt');
			expect(jwt).toEqual(BUILT_IN_SECURITY_SCHEMES.jwt);

			const bearer = getSecurityScheme('bearer');
			expect(bearer).toEqual(BUILT_IN_SECURITY_SCHEMES.bearer);

			const apiKey = getSecurityScheme('apiKey');
			expect(apiKey).toEqual(BUILT_IN_SECURITY_SCHEMES.apiKey);
		});

		it('should return undefined for unknown scheme with no custom schemes', () => {
			const result = getSecurityScheme('unknown');
			expect(result).toBeUndefined();
		});

		it('should return custom scheme when provided', () => {
			const customSchemes: Record<string, SecurityScheme> = {
				myAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'opaque',
					description: 'My custom auth',
				},
			};

			const result = getSecurityScheme('myAuth', customSchemes);
			expect(result).toEqual(customSchemes.myAuth);
		});

		it('should prefer custom scheme over built-in with same name', () => {
			const customSchemes: Record<string, SecurityScheme> = {
				jwt: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'CustomJWT',
					description: 'Overridden JWT',
				},
			};

			const result = getSecurityScheme('jwt', customSchemes);
			expect(result?.bearerFormat).toBe('CustomJWT');
			expect(result?.description).toBe('Overridden JWT');
		});

		it('should fall back to built-in when custom scheme not found', () => {
			const customSchemes: Record<string, SecurityScheme> = {
				myAuth: {
					type: 'apiKey',
					in: 'header',
					name: 'X-My-Key',
				},
			};

			const result = getSecurityScheme('jwt', customSchemes);
			expect(result).toEqual(BUILT_IN_SECURITY_SCHEMES.jwt);
		});

		it('should return undefined when scheme not in custom or built-in', () => {
			const customSchemes: Record<string, SecurityScheme> = {
				myAuth: {
					type: 'apiKey',
					in: 'header',
					name: 'X-My-Key',
				},
			};

			const result = getSecurityScheme('nonexistent', customSchemes);
			expect(result).toBeUndefined();
		});

		it('should handle empty custom schemes object', () => {
			const result = getSecurityScheme('jwt', {});
			expect(result).toEqual(BUILT_IN_SECURITY_SCHEMES.jwt);
		});
	});

	describe('SecurityScheme types', () => {
		it('should support apiKey in query', () => {
			const scheme: SecurityScheme = {
				type: 'apiKey',
				in: 'query',
				name: 'api_key',
			};
			expect(scheme.in).toBe('query');
		});

		it('should support apiKey in cookie', () => {
			const scheme: SecurityScheme = {
				type: 'apiKey',
				in: 'cookie',
				name: 'session',
			};
			expect(scheme.in).toBe('cookie');
		});

		it('should support oauth2 with all flow types', () => {
			const scheme: SecurityScheme = {
				type: 'oauth2',
				flows: {
					implicit: {
						authorizationUrl: 'https://auth.example.com/authorize',
						scopes: { read: 'Read access', write: 'Write access' },
					},
					password: {
						tokenUrl: 'https://auth.example.com/token',
						scopes: { admin: 'Admin access' },
					},
					clientCredentials: {
						tokenUrl: 'https://auth.example.com/token',
						scopes: { api: 'API access' },
					},
					authorizationCode: {
						authorizationUrl: 'https://auth.example.com/authorize',
						tokenUrl: 'https://auth.example.com/token',
						refreshUrl: 'https://auth.example.com/refresh',
						scopes: { openid: 'OpenID', profile: 'Profile' },
					},
				},
			};

			expect(scheme.flows?.implicit?.authorizationUrl).toBe(
				'https://auth.example.com/authorize',
			);
			expect(scheme.flows?.authorizationCode?.refreshUrl).toBe(
				'https://auth.example.com/refresh',
			);
		});

		it('should support mutualTLS type', () => {
			const scheme: SecurityScheme = {
				type: 'mutualTLS',
				description: 'Mutual TLS authentication',
			};
			expect(scheme.type).toBe('mutualTLS');
		});

		it('should support vendor extensions', () => {
			const scheme: SecurityScheme = {
				type: 'apiKey',
				in: 'header',
				name: 'Authorization',
				'x-amazon-apigateway-authtype': 'custom',
				'x-custom-extension': { nested: 'value' },
			};

			expect(scheme['x-amazon-apigateway-authtype']).toBe('custom');
			expect(scheme['x-custom-extension']).toEqual({ nested: 'value' });
		});
	});
});
