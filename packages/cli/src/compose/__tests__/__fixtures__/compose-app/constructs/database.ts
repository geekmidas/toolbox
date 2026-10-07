import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const database = new KyselyDatabase('Database');

/** Better Auth's tables, in a schema of their own. */
export const authDatabase = database.schema('AuthDatabase');
