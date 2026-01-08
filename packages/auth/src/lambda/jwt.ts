import type {
	APIGatewayAuthorizerResult,
	APIGatewayRequestAuthorizerEvent,
	APIGatewayTokenAuthorizerEvent,
	Context as LambdaContext,
	PolicyDocument,
} from 'aws-lambda';
import {
	type JwtClaims,
	type JwtConfig,
	JwtVerifier,
	type TokenExtractionOptions,
} from '../jwt';

export {
	JwtVerifier,
	type JwtClaims,
	type JwtConfig,
	type TokenExtractionOptions,
};

function generatePolicy(
	principalId: string,
	effect: 'Allow' | 'Deny',
	resource: string,
	context?: Record<string, string | number | boolean>,
): APIGatewayAuthorizerResult {
	const policyDocument: PolicyDocument = {
		Version: '2012-10-17',
		Statement: [
			{
				Action: 'execute-api:Invoke',
				Effect: effect,
				Resource: resource,
			},
		],
	};

	return {
		principalId,
		policyDocument,
		context,
	};
}

function getWildcardResource(methodArn: string): string {
	const parts = methodArn.split('/');
	return `${parts[0]}/${parts[1]}/*`;
}

export interface JwtAuthorizerOptions<TClaims extends JwtClaims = JwtClaims> {
	config: JwtConfig;
	extraction?: TokenExtractionOptions;
	wildcardResource?: boolean;
	getPrincipalId?: (claims: TClaims) => string;
	getContext?: (
		claims: TClaims,
	) => Record<string, string | number | boolean> | undefined;
	authorize?: (claims: TClaims) => boolean | Promise<boolean>;
}

/**
 * JWT Lambda Authorizer
 *
 * @example
 * ```typescript
 * const authorizer = new JwtAuthorizer({
 *   config: {
 *     jwksUri: 'https://auth.example.com/.well-known/jwks.json',
 *     issuer: 'https://auth.example.com',
 *   },
 *   getContext: (claims) => ({ userId: claims.sub! }),
 * });
 *
 * // TOKEN authorizer
 * export const tokenHandler = authorizer.tokenHandler();
 *
 * // REQUEST authorizer
 * export const requestHandler = authorizer.requestHandler();
 * ```
 */
export class JwtAuthorizer<TClaims extends JwtClaims = JwtClaims> {
	private readonly verifier: JwtVerifier<TClaims>;
	private readonly extraction: TokenExtractionOptions;
	private readonly wildcardResource: boolean;
	private readonly getPrincipalId: (claims: TClaims) => string;
	private readonly getContext?: (
		claims: TClaims,
	) => Record<string, string | number | boolean> | undefined;
	private readonly authorize?: (claims: TClaims) => boolean | Promise<boolean>;

	constructor(options: JwtAuthorizerOptions<TClaims>) {
		this.verifier = new JwtVerifier(options.config);
		this.extraction = options.extraction ?? {};
		this.wildcardResource = options.wildcardResource ?? true;
		this.getPrincipalId = options.getPrincipalId ?? ((c) => c.sub ?? 'unknown');
		this.getContext = options.getContext;
		this.authorize = options.authorize;
	}

	/**
	 * Returns a TOKEN authorizer handler
	 */
	tokenHandler() {
		return async (
			event: APIGatewayTokenAuthorizerEvent,
			_context: LambdaContext,
		): Promise<APIGatewayAuthorizerResult> => {
			const { authorizationToken, methodArn } = event;
			const resource = this.wildcardResource
				? getWildcardResource(methodArn)
				: methodArn;

			const token = authorizationToken.startsWith('Bearer ')
				? authorizationToken.slice(7)
				: authorizationToken;

			try {
				const claims = await this.verifier.verify(token);

				if (this.authorize) {
					const isAuthorized = await this.authorize(claims);
					if (!isAuthorized) {
						return generatePolicy('unauthorized', 'Deny', resource);
					}
				}

				const principalId = this.getPrincipalId(claims);
				const context = this.getContext?.(claims);

				return generatePolicy(principalId, 'Allow', resource, context);
			} catch {
				return generatePolicy('unauthorized', 'Deny', resource);
			}
		};
	}

	/**
	 * Returns a REQUEST authorizer handler
	 */
	requestHandler() {
		const {
			headerName = 'authorization',
			cookieName,
			tokenPrefix = 'Bearer ',
		} = this.extraction;

		const extractToken = (
			event: APIGatewayRequestAuthorizerEvent,
		): string | null => {
			const headers = event.headers ?? {};
			const headerKey = Object.keys(headers).find(
				(k) => k.toLowerCase() === headerName.toLowerCase(),
			);
			if (headerKey) {
				const headerValue = headers[headerKey];
				if (headerValue) {
					if (tokenPrefix && headerValue.startsWith(tokenPrefix)) {
						return headerValue.slice(tokenPrefix.length);
					}
					return headerValue;
				}
			}

			if (cookieName) {
				const cookieHeader = headers['cookie'] ?? headers['Cookie'] ?? '';
				const match = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
				if (match?.[1]) {
					return match[1];
				}
			}

			return null;
		};

		return async (
			event: APIGatewayRequestAuthorizerEvent,
			_context: LambdaContext,
		): Promise<APIGatewayAuthorizerResult> => {
			const methodArn = event.methodArn;
			const resource = this.wildcardResource
				? getWildcardResource(methodArn)
				: methodArn;

			const token = extractToken(event);

			if (!token) {
				return generatePolicy('unauthorized', 'Deny', resource);
			}

			try {
				const claims = await this.verifier.verify(token);

				if (this.authorize) {
					const isAuthorized = await this.authorize(claims);
					if (!isAuthorized) {
						return generatePolicy('unauthorized', 'Deny', resource);
					}
				}

				const principalId = this.getPrincipalId(claims);
				const context = this.getContext?.(claims);

				return generatePolicy(principalId, 'Allow', resource, context);
			} catch {
				return generatePolicy('unauthorized', 'Deny', resource);
			}
		};
	}
}
