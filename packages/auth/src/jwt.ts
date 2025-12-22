import * as jose from 'jose';

/**
 * Standard JWT claims
 */
export interface JwtClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  jti?: string;
}

/**
 * Configuration for JWT verification with a symmetric secret
 */
export interface JwtSecretConfig {
  secret: string;
  issuer?: string;
  audience?: string | string[];
  algorithms?: string[];
}

/**
 * Configuration for JWT verification with JWKS
 */
export interface JwtJwksConfig {
  jwksUri: string;
  issuer?: string;
  audience?: string | string[];
  algorithms?: string[];
}

export type JwtConfig = JwtSecretConfig | JwtJwksConfig;

/**
 * Options for token extraction from requests
 */
export interface TokenExtractionOptions {
  headerName?: string;
  cookieName?: string;
  tokenPrefix?: string;
}

export function isJwksConfig(config: JwtConfig): config is JwtJwksConfig {
  return 'jwksUri' in config;
}

/**
 * JWT Verifier with JWKS caching
 */
export class JwtVerifier<TClaims extends JwtClaims = JwtClaims> {
  private jwks: jose.JWTVerifyGetKey | null = null;
  private readonly verifyOptions: jose.JWTVerifyOptions;

  constructor(private readonly config: JwtConfig) {
    this.verifyOptions = {
      issuer: config.issuer,
      audience: config.audience,
      algorithms:
        config.algorithms ?? (isJwksConfig(config) ? undefined : ['HS256']),
    };
  }

  async verify(token: string): Promise<TClaims> {
    if (isJwksConfig(this.config)) {
      if (!this.jwks) {
        this.jwks = jose.createRemoteJWKSet(new URL(this.config.jwksUri));
      }
      const { payload } = await jose.jwtVerify(
        token,
        this.jwks,
        this.verifyOptions,
      );
      return payload as unknown as TClaims;
    }

    const secret = new TextEncoder().encode(this.config.secret);
    const { payload } = await jose.jwtVerify(token, secret, this.verifyOptions);
    return payload as unknown as TClaims;
  }

  async verifyOrNull(token: string): Promise<TClaims | null> {
    try {
      return await this.verify(token);
    } catch {
      return null;
    }
  }

  clearCache(): void {
    this.jwks = null;
  }
}

/**
 * Decode a JWT without verification
 * WARNING: This does NOT verify the token signature!
 */
export function decodeJwt<TClaims extends JwtClaims = JwtClaims>(
  token: string,
): TClaims {
  return jose.decodeJwt(token) as unknown as TClaims;
}
