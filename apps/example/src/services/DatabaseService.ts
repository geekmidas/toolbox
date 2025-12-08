import type { EnvironmentParser } from '@geekmidas/envkit';

/**
 * Example database service demonstrating the Service pattern.
 * In a real application, this would be a Kysely database instance.
 */
export interface Database {
  query: <T>(sql: string) => Promise<T[]>;
}

let instance: Database | null = null;

export const DatabaseService = {
  serviceName: 'database' as const,
  register(envParser: EnvironmentParser<{}>): any {
    // Create the config parser - this tracks environment variables
    const configParser = envParser.create((get) => ({
      connectionString: get('DATABASE_URL').string(),
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
        // In a real app, create Kysely instance here:
        // instance = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: config.connectionString }) }) });
        instance = {
          query: async <T>(_sql: string): Promise<T[]> => {
            console.log(`Would query: ${_sql} using ${config.connectionString}`);
            return [] as T[];
          },
        };
      }
      return instance;
    })();
  },
} as const;
