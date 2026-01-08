import {
	CamelCasePlugin,
	type Generated,
	Kysely,
	PostgresDialect,
	sql,
} from 'kysely';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { introspectSchema, introspectTable } from '../introspection';

interface TestDatabase {
	studioIntrospectUsers: {
		id: Generated<number>;
		name: string;
		email: string;
		isActive: boolean;
		metadata: Generated<Record<string, unknown> | null>;
		createdAt: Generated<Date>;
		updatedAt: Generated<Date>;
	};
	studioIntrospectPosts: {
		id: Generated<string>;
		userId: number;
		title: string;
		content: string | null;
		viewCount: number;
		publishedAt: Date | null;
		createdAt: Generated<Date>;
	};
	studioIntrospectTags: {
		id: Generated<number>;
		name: string;
	};
	studioIntrospectExcluded: {
		id: Generated<number>;
		value: string;
	};
}

describe('Schema Introspection Integration Tests', () => {
	let db: Kysely<TestDatabase>;

	beforeAll(async () => {
		db = new Kysely<TestDatabase>({
			dialect: new PostgresDialect({
				pool: new pg.Pool({
					...TEST_DATABASE_CONFIG,
					database: 'postgres',
				}),
			}),
			plugins: [new CamelCasePlugin()],
		});

		// Create users table with various column types
		await db.schema
			.createTable('studio_introspect_users')
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('name', 'varchar(255)', (col) => col.notNull())
			.addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
			.addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
			.addColumn('metadata', 'jsonb')
			.addColumn('created_at', 'timestamptz', (col) =>
				col.defaultTo(sql`now()`).notNull(),
			)
			.addColumn('updated_at', 'timestamptz', (col) =>
				col.defaultTo(sql`now()`).notNull(),
			)
			.execute();

		// Create posts table with foreign key
		await db.schema
			.createTable('studio_introspect_posts')
			.ifNotExists()
			.addColumn('id', 'uuid', (col) =>
				col.primaryKey().defaultTo(sql`gen_random_uuid()`),
			)
			.addColumn('user_id', 'integer', (col) =>
				col
					.notNull()
					.references('studio_introspect_users.id')
					.onDelete('cascade'),
			)
			.addColumn('title', 'varchar(500)', (col) => col.notNull())
			.addColumn('content', 'text')
			.addColumn('view_count', 'integer', (col) => col.notNull().defaultTo(0))
			.addColumn('published_at', 'timestamp')
			.addColumn('created_at', 'timestamptz', (col) =>
				col.defaultTo(sql`now()`).notNull(),
			)
			.execute();

		// Create simple tags table
		await db.schema
			.createTable('studio_introspect_tags')
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('name', 'varchar(100)', (col) => col.notNull())
			.execute();

		// Create excluded table (for exclusion testing)
		await db.schema
			.createTable('studio_introspect_excluded')
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('value', 'varchar(100)', (col) => col.notNull())
			.execute();
	});

	afterEach(async () => {
		// Clean up data after each test
		await db.deleteFrom('studioIntrospectPosts').execute();
		await db.deleteFrom('studioIntrospectUsers').execute();
		await db.deleteFrom('studioIntrospectTags').execute();
		await db.deleteFrom('studioIntrospectExcluded').execute();
	});

	afterAll(async () => {
		// Drop tables and close connection
		await db.schema.dropTable('studio_introspect_posts').ifExists().execute();
		await db.schema.dropTable('studio_introspect_users').ifExists().execute();
		await db.schema.dropTable('studio_introspect_tags').ifExists().execute();
		await db.schema
			.dropTable('studio_introspect_excluded')
			.ifExists()
			.execute();
		await db.destroy();
	});

	describe('introspectSchema', () => {
		it('should discover all tables in the public schema', async () => {
			const schema = await introspectSchema(db, []);

			// Find our test tables
			const tableNames = schema.tables.map((t) => t.name);
			expect(tableNames).toContain('studio_introspect_users');
			expect(tableNames).toContain('studio_introspect_posts');
			expect(tableNames).toContain('studio_introspect_tags');
			expect(tableNames).toContain('studio_introspect_excluded');
			expect(schema.updatedAt).toBeInstanceOf(Date);
		});

		it('should exclude specified tables', async () => {
			const schema = await introspectSchema(db, ['studio_introspect_excluded']);

			const tableNames = schema.tables.map((t) => t.name);
			expect(tableNames).toContain('studio_introspect_users');
			expect(tableNames).toContain('studio_introspect_posts');
			expect(tableNames).not.toContain('studio_introspect_excluded');
		});

		it('should exclude multiple tables', async () => {
			const schema = await introspectSchema(db, [
				'studio_introspect_excluded',
				'studio_introspect_tags',
			]);

			const tableNames = schema.tables.map((t) => t.name);
			expect(tableNames).toContain('studio_introspect_users');
			expect(tableNames).toContain('studio_introspect_posts');
			expect(tableNames).not.toContain('studio_introspect_excluded');
			expect(tableNames).not.toContain('studio_introspect_tags');
		});
	});

	describe('introspectTable', () => {
		it('should return column information for users table', async () => {
			const tableInfo = await introspectTable(db, 'studio_introspect_users');

			expect(tableInfo.name).toBe('studio_introspect_users');
			expect(tableInfo.schema).toBe('public');
			expect(tableInfo.columns.length).toBe(7);

			// Find specific columns
			const idCol = tableInfo.columns.find((c) => c.name === 'id');
			const nameCol = tableInfo.columns.find((c) => c.name === 'name');
			const emailCol = tableInfo.columns.find((c) => c.name === 'email');
			const isActiveCol = tableInfo.columns.find((c) => c.name === 'is_active');
			const metadataCol = tableInfo.columns.find((c) => c.name === 'metadata');
			const createdAtCol = tableInfo.columns.find(
				(c) => c.name === 'created_at',
			);

			// Check id column (primary key, serial)
			expect(idCol).toBeDefined();
			expect(idCol?.type).toBe('number');
			expect(idCol?.rawType).toBe('int4');
			expect(idCol?.isPrimaryKey).toBe(true);
			expect(idCol?.nullable).toBe(false);

			// Check name column (varchar, not null)
			expect(nameCol).toBeDefined();
			expect(nameCol?.type).toBe('string');
			expect(nameCol?.rawType).toBe('varchar');
			expect(nameCol?.nullable).toBe(false);

			// Check email column (varchar, unique)
			expect(emailCol).toBeDefined();
			expect(emailCol?.type).toBe('string');
			expect(emailCol?.nullable).toBe(false);

			// Check is_active column (boolean with default)
			expect(isActiveCol).toBeDefined();
			expect(isActiveCol?.type).toBe('boolean');
			expect(isActiveCol?.rawType).toBe('bool');
			expect(isActiveCol?.nullable).toBe(false);

			// Check metadata column (jsonb, nullable)
			expect(metadataCol).toBeDefined();
			expect(metadataCol?.type).toBe('json');
			expect(metadataCol?.rawType).toBe('jsonb');
			expect(metadataCol?.nullable).toBe(true);

			// Check created_at column (timestamptz)
			expect(createdAtCol).toBeDefined();
			expect(createdAtCol?.type).toBe('datetime');
			expect(createdAtCol?.rawType).toBe('timestamptz');
		});

		it('should detect primary key', async () => {
			const tableInfo = await introspectTable(db, 'studio_introspect_users');

			expect(tableInfo.primaryKey).toEqual(['id']);

			const idColumn = tableInfo.columns.find((c) => c.name === 'id');
			expect(idColumn?.isPrimaryKey).toBe(true);
		});

		it('should detect foreign keys', async () => {
			const tableInfo = await introspectTable(db, 'studio_introspect_posts');

			const userIdCol = tableInfo.columns.find((c) => c.name === 'user_id');
			expect(userIdCol).toBeDefined();
			expect(userIdCol?.isForeignKey).toBe(true);
			expect(userIdCol?.foreignKeyTable).toBe('studio_introspect_users');
			expect(userIdCol?.foreignKeyColumn).toBe('id');
		});

		it('should detect uuid primary key', async () => {
			const tableInfo = await introspectTable(db, 'studio_introspect_posts');

			expect(tableInfo.primaryKey).toEqual(['id']);

			const idColumn = tableInfo.columns.find((c) => c.name === 'id');
			expect(idColumn).toBeDefined();
			expect(idColumn?.type).toBe('uuid');
			expect(idColumn?.rawType).toBe('uuid');
			expect(idColumn?.isPrimaryKey).toBe(true);
		});

		it('should map PostgreSQL types correctly', async () => {
			const usersTable = await introspectTable(db, 'studio_introspect_users');
			const postsTable = await introspectTable(db, 'studio_introspect_posts');

			// Integer types -> number
			const userIdCol = usersTable.columns.find((c) => c.name === 'id');
			expect(userIdCol?.type).toBe('number');

			// Boolean -> boolean
			const isActiveCol = usersTable.columns.find(
				(c) => c.name === 'is_active',
			);
			expect(isActiveCol?.type).toBe('boolean');

			// JSONB -> json
			const metadataCol = usersTable.columns.find((c) => c.name === 'metadata');
			expect(metadataCol?.type).toBe('json');

			// Timestamptz -> datetime
			const createdAtCol = usersTable.columns.find(
				(c) => c.name === 'created_at',
			);
			expect(createdAtCol?.type).toBe('datetime');

			// UUID -> uuid
			const postIdCol = postsTable.columns.find((c) => c.name === 'id');
			expect(postIdCol?.type).toBe('uuid');

			// Text -> string
			const contentCol = postsTable.columns.find((c) => c.name === 'content');
			expect(contentCol?.type).toBe('string');
			expect(contentCol?.rawType).toBe('text');

			// Timestamp (without tz) -> datetime
			const publishedCol = postsTable.columns.find(
				(c) => c.name === 'published_at',
			);
			expect(publishedCol?.type).toBe('datetime');
		});

		it('should detect nullable columns', async () => {
			const tableInfo = await introspectTable(db, 'studio_introspect_posts');

			const titleCol = tableInfo.columns.find((c) => c.name === 'title');
			const contentCol = tableInfo.columns.find((c) => c.name === 'content');
			const publishedAtCol = tableInfo.columns.find(
				(c) => c.name === 'published_at',
			);

			expect(titleCol?.nullable).toBe(false);
			expect(contentCol?.nullable).toBe(true);
			expect(publishedAtCol?.nullable).toBe(true);
		});

		it('should provide estimated row count when data exists', async () => {
			// Insert some data
			const user = await db
				.insertInto('studioIntrospectUsers')
				.values({
					name: 'Test User',
					email: 'test@example.com',
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			await db
				.insertInto('studioIntrospectPosts')
				.values([
					{ userId: user.id, title: 'Post 1' },
					{ userId: user.id, title: 'Post 2' },
					{ userId: user.id, title: 'Post 3' },
				])
				.execute();

			// ANALYZE to update statistics
			await sql`ANALYZE studio_introspect_posts`.execute(db);

			const tableInfo = await introspectTable(db, 'studio_introspect_posts');

			// Row count estimate should exist (might not be exact)
			expect(tableInfo.estimatedRowCount).toBeDefined();
			expect(tableInfo.estimatedRowCount).toBeGreaterThan(0);
		});

		it('should return all columns in ordinal position order', async () => {
			const tableInfo = await introspectTable(db, 'studio_introspect_users');

			const columnNames = tableInfo.columns.map((c) => c.name);
			expect(columnNames).toEqual([
				'id',
				'name',
				'email',
				'is_active',
				'metadata',
				'created_at',
				'updated_at',
			]);
		});
	});
});
