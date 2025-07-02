import { type Kysely, type MigrationProvider, Migrator } from 'kysely';
import { PostgresMigrator } from './PostgresMigrator';

const logger = console;

export class PostgresKyselyMigrator extends PostgresMigrator {
  constructor(
    private options: {
      uri: string;
      db: Kysely<any>;
      provider: MigrationProvider;
    },
  ) {
    super(options.uri);
  }

  async migrate(): Promise<void> {
    const migrator = new Migrator({
      db: this.options.db,
      provider: this.options.provider,
    });
    const migrations = await migrator.migrateToLatest();

    if (migrations.error) {
      logger.error(migrations.error, `Failed to apply migrations`);
      throw migrations.error;
    }

    await this.options.db.destroy();

    logger.log(`Applied ${migrations.results?.length} migrations successfully`);
  }
}
