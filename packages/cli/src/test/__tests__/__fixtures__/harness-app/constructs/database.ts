import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';

export const database = new KyselyDatabase('Database');
export const authDatabase = database.schema('AuthDatabase');
