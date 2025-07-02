import {
  CamelCasePlugin,
  type ControlledTransaction,
  Kysely,
  PostgresDialect,
} from 'kysely';
import pg from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../test/globalSetup';
import { KyselyFactory } from '../KyselyFactory';

describe('KyselyFactory', () => {
  interface Database {
    users: {
      id: number;
      name: string;
      email: string;
      createdAt: Date;
    };
    posts: {
      id: number;
      title: string;
      content: string;
      userId: number;
      createdAt: Date;
    };
  }

  let db: Kysely<Database>;
  let trx: ControlledTransaction<Database, []>;
  beforeAll(async () => {
    db = new Kysely({
      dialect: new PostgresDialect({
        pool: new pg.Pool(TEST_DATABASE_CONFIG),
      }),
      plugins: [new CamelCasePlugin()],
    });
  });

  beforeEach(async () => {
    trx = await db.startTransaction().execute();
  });
  afterEach(async () => {
    await trx.rollback().execute();
  });

  afterAll(async () => {
    await db.destroy();
  });
  it('KyselyFactory.insert', async () => {
    const userBuilder = KyselyFactory.createBuilder<Database, 'users'>({
      table: 'users',
      defaults: async (attrs) => ({
        name: 'John Doe',
      }),
    });

    const builders = {
      user: userBuilder,
    };

    const factory = new KyselyFactory<Database, typeof builders, {}>(
      builders,
      {},
      trx,
    );

    const user = await factory.insert('user', {
      email: `user${Date.now()}@example.com`,
      createdAt: new Date(),
    });

    expect(user).toBeDefined();
  });
});
