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
  async register() {
    if (!instance) {
      // In a real app, create Kysely instance here:
      // instance = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
      instance = {
        query: async <T>(_sql: string): Promise<T[]> => {
          // Mock implementation for example
          return [] as T[];
        },
      };
    }
    return instance;
  },
};
