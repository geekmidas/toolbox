export interface TokenStorage {
	getAccessToken(): Promise<string | null> | string | null;
	setAccessToken(token: string, ttl?: number): Promise<void> | void;
	getRefreshToken(): Promise<string | null> | string | null;
	setRefreshToken(token: string, ttl?: number): Promise<void> | void;
	clearTokens(): Promise<void> | void;
}

export class LocalStorageTokenStorage implements TokenStorage {
	private accessTokenKey: string;
	private refreshTokenKey: string;

	constructor(
		accessTokenKey: string = 'access_token',
		refreshTokenKey: string = 'refresh_token',
	) {
		this.accessTokenKey = accessTokenKey;
		this.refreshTokenKey = refreshTokenKey;
	}

	getAccessToken(): string | null {
		if (typeof window === 'undefined') return null;
		return localStorage.getItem(this.accessTokenKey);
	}

	setAccessToken(token: string, ttl?: number): void {
		if (typeof window === 'undefined') return;
		localStorage.setItem(this.accessTokenKey, token);
	}

	getRefreshToken(): string | null {
		if (typeof window === 'undefined') return null;
		return localStorage.getItem(this.refreshTokenKey);
	}

	setRefreshToken(token: string, ttl?: number): void {
		if (typeof window === 'undefined') return;
		localStorage.setItem(this.refreshTokenKey, token);
	}

	clearTokens(): void {
		if (typeof window === 'undefined') return;
		localStorage.removeItem(this.accessTokenKey);
		localStorage.removeItem(this.refreshTokenKey);
	}
}

export class MemoryTokenStorage implements TokenStorage {
	private accessToken: string | null = null;
	private refreshToken: string | null = null;

	getAccessToken(): string | null {
		return this.accessToken;
	}

	setAccessToken(token: string, ttl?: number): void {
		this.accessToken = token;
	}

	getRefreshToken(): string | null {
		return this.refreshToken;
	}

	setRefreshToken(token: string, ttl?: number): void {
		this.refreshToken = token;
	}

	clearTokens(): void {
		this.accessToken = null;
		this.refreshToken = null;
	}
}

export interface TokenClientOptions {
	storage?: TokenStorage;
	refreshEndpoint?: string;
	onTokenRefresh?: (tokens: {
		accessToken: string;
		refreshToken?: string;
	}) => void;
	onTokenExpired?: () => void;
}

export class TokenClient {
	private storage: TokenStorage;
	private refreshEndpoint?: string;
	private onTokenRefresh?: (tokens: {
		accessToken: string;
		refreshToken?: string;
	}) => void;
	private onTokenExpired?: () => void;

	constructor(options: TokenClientOptions = {}) {
		this.storage = options.storage || new LocalStorageTokenStorage();
		this.refreshEndpoint = options.refreshEndpoint;
		this.onTokenRefresh = options.onTokenRefresh;
		this.onTokenExpired = options.onTokenExpired;
	}

	async getAccessToken(): Promise<string | null> {
		return await this.storage.getAccessToken();
	}

	async getRefreshToken(): Promise<string | null> {
		return await this.storage.getRefreshToken();
	}

	async setTokens(
		accessToken: string,
		refreshToken?: string,
		accessTtl?: number,
		refreshTtl?: number,
	): Promise<void> {
		await this.storage.setAccessToken(accessToken, accessTtl);
		if (refreshToken) {
			await this.storage.setRefreshToken(refreshToken, refreshTtl);
		}
	}

	async clearTokens(): Promise<void> {
		await this.storage.clearTokens();
	}

	isTokenExpired(token: string): boolean {
		try {
			const parts = token.split('.');
			const payloadPart = parts[1];
			if (!payloadPart) return true;
			const payload = JSON.parse(atob(payloadPart));
			const now = Math.floor(Date.now() / 1000);
			return payload.exp < now;
		} catch {
			return true;
		}
	}

	getTokenExpiration(token: string): Date | null {
		try {
			const parts = token.split('.');
			const payloadPart = parts[1];
			if (!payloadPart) return null;
			const payload = JSON.parse(atob(payloadPart));
			return new Date(payload.exp * 1000);
		} catch {
			return null;
		}
	}

	async refreshTokens(): Promise<boolean> {
		const refreshToken = await this.getRefreshToken();

		if (!refreshToken || !this.refreshEndpoint) {
			return false;
		}

		try {
			const response = await fetch(this.refreshEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ refreshToken }),
			});

			if (!response.ok) {
				throw new Error('Failed to refresh token');
			}

			const data = (await response.json()) as {
				accessToken: string;
				refreshToken: string;
			};
			const { accessToken, refreshToken: newRefreshToken } = data;

			await this.setTokens(accessToken, newRefreshToken);

			if (this.onTokenRefresh) {
				this.onTokenRefresh({ accessToken, refreshToken: newRefreshToken });
			}

			return true;
		} catch (error) {
			await this.clearTokens();
			if (this.onTokenExpired) {
				this.onTokenExpired();
			}
			return false;
		}
	}

	async getValidAccessToken(): Promise<string | null> {
		const accessToken = await this.getAccessToken();

		if (!accessToken) {
			return null;
		}

		if (this.isTokenExpired(accessToken)) {
			const refreshed = await this.refreshTokens();
			if (!refreshed) {
				return null;
			}
			return await this.getAccessToken();
		}

		return accessToken;
	}

	async createAuthHeaders(): Promise<Record<string, string>> {
		const token = await this.getAccessToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	async createValidAuthHeaders(): Promise<Record<string, string>> {
		const token = await this.getValidAccessToken();
		return token ? { Authorization: `Bearer ${token}` } : {};
	}
}

export { CacheTokenStorage } from './cacheTokenStorage.js';
