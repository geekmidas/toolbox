import type { EnvironmentParser } from '@geekmidas/envkit';

/**
 * Example auth service demonstrating the Service pattern.
 * In a real application, this would handle JWT verification and user sessions.
 */
export interface AuthClient {
  verifyToken: (token: string) => Promise<{ userId: string } | null>;
  getUserById: (userId: string) => Promise<{ id: string; email: string } | null>;
}

let instance: AuthClient | null = null;

export const AuthService = {
  serviceName: 'auth' as const,
  register(envParser: EnvironmentParser<{}>): any {
    // Create the config parser - this tracks environment variables
    const configParser = envParser.create((get) => ({
      jwtSecret: get('JWT_SECRET').string(),
      issuer: get('JWT_ISSUER').string().optional(),
    }));

    // For environment detection (when env is empty), return ConfigParser
    // This allows build-time detection without needing actual env values
    // @ts-ignore - accessing internal property to detect sniffer
    const envData = envParser.env || {};
    if (Object.keys(envData).length === 0) {
      return configParser;
    }

    // Runtime: return a promise that resolves to the service instance
    return (async () => {
      if (!instance) {
        const config = configParser.parse();
        // In a real app, create TokenManager or auth client here
        instance = {
          verifyToken: async (token: string) => {
            console.log(
              `Verifying token with secret ${config.jwtSecret.slice(0, 3)}...`,
            );
            // Mock implementation
            if (token === 'valid-token') {
              return { userId: 'user-123' };
            }
            return null;
          },
          getUserById: async (userId: string) => {
            console.log(`Getting user ${userId}`);
            return { id: userId, email: 'user@example.com' };
          },
        };
      }
      return instance;
    })();
  },
} as const;
