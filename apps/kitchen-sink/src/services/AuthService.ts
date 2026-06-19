import type { Service } from '@geekmidas/services';

export interface AuthClient {
	verifyToken: (token: string) => Promise<{ userId: string } | null>;
	getUserById: (
		userId: string,
	) => Promise<{ id: string; email: string } | null>;
}

/**
 * Mock auth service demonstrating session/DI. A real app would verify JWTs here;
 * `JWT_SECRET`/`JWT_ISSUER` are read (and thus sniffed into the manifest) via the
 * `.create((get) => …)` call.
 */
export const AuthService = {
	serviceName: 'auth' as const,
	async register({ envParser }) {
		const config = envParser
			.create((get) => ({
				jwtSecret: get('JWT_SECRET').string(),
				issuer: get('JWT_ISSUER').string().optional(),
			}))
			.parse();

		const client: AuthClient = {
			verifyToken: async (token) =>
				token === `${config.jwtSecret}-token` ? { userId: 'user-123' } : null,
			getUserById: async (userId) => ({
				id: userId,
				email: 'user@example.com',
			}),
		};
		return client;
	},
} satisfies Service<'auth', AuthClient>;
