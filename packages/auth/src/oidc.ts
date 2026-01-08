import * as jose from 'jose';
import type { JwtClaims, TokenExtractionOptions } from './jwt';

export type { TokenExtractionOptions };

/**
 * Standard OIDC claims (extends JWT claims)
 */
export interface OidcClaims extends JwtClaims {
	nonce?: string;
	auth_time?: number;
	at_hash?: string;
	c_hash?: string;
	azp?: string;
}

/**
 * Standard OIDC user info claims
 */
export interface OidcUserInfo {
	sub: string;
	name?: string;
	given_name?: string;
	family_name?: string;
	middle_name?: string;
	nickname?: string;
	preferred_username?: string;
	profile?: string;
	picture?: string;
	website?: string;
	email?: string;
	email_verified?: boolean;
	gender?: string;
	birthdate?: string;
	zoneinfo?: string;
	locale?: string;
	phone_number?: string;
	phone_number_verified?: boolean;
	address?: {
		formatted?: string;
		street_address?: string;
		locality?: string;
		region?: string;
		postal_code?: string;
		country?: string;
	};
	updated_at?: number;
}

/**
 * OIDC Discovery document
 */
export interface OidcDiscovery {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint?: string;
	jwks_uri: string;
	scopes_supported?: string[];
	response_types_supported: string[];
	claims_supported?: string[];
}

/**
 * Configuration for OIDC verification
 */
export interface OidcConfig {
	issuer: string;
	audience: string | string[];
	cacheDiscovery?: boolean;
}

/**
 * OIDC Verifier with auto-discovery and caching
 */
export class OidcVerifier<
	TClaims extends OidcClaims = OidcClaims,
	TUserInfo extends OidcUserInfo = OidcUserInfo,
> {
	private discovery: OidcDiscovery | null = null;
	private jwks: jose.JWTVerifyGetKey | null = null;
	private readonly discoveryUrl: string;

	constructor(private readonly config: OidcConfig) {
		this.discoveryUrl = config.issuer.endsWith('/')
			? `${config.issuer}.well-known/openid-configuration`
			: `${config.issuer}/.well-known/openid-configuration`;
	}

	async getDiscovery(): Promise<OidcDiscovery> {
		if (this.discovery && this.config.cacheDiscovery !== false) {
			return this.discovery;
		}

		const response = await fetch(this.discoveryUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch OIDC discovery: ${response.statusText}`);
		}

		this.discovery = (await response.json()) as OidcDiscovery;
		return this.discovery;
	}

	private async getJwks(): Promise<jose.JWTVerifyGetKey> {
		if (this.jwks && this.config.cacheDiscovery !== false) {
			return this.jwks;
		}

		const disc = await this.getDiscovery();
		this.jwks = jose.createRemoteJWKSet(new URL(disc.jwks_uri));
		return this.jwks;
	}

	async verify(token: string): Promise<TClaims> {
		const key = await this.getJwks();
		const { payload } = await jose.jwtVerify(token, key, {
			issuer: this.config.issuer,
			audience: this.config.audience,
		});
		return payload as unknown as TClaims;
	}

	async verifyOrNull(token: string): Promise<TClaims | null> {
		try {
			return await this.verify(token);
		} catch {
			return null;
		}
	}

	async fetchUserInfo(token: string): Promise<TUserInfo | null> {
		try {
			const disc = await this.getDiscovery();
			if (!disc.userinfo_endpoint) {
				return null;
			}

			const response = await fetch(disc.userinfo_endpoint, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!response.ok) {
				return null;
			}

			return (await response.json()) as TUserInfo;
		} catch {
			return null;
		}
	}

	clearCache(): void {
		this.discovery = null;
		this.jwks = null;
	}
}
