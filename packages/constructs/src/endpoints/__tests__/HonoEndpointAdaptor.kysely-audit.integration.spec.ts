import type { AuditableAction } from '@geekmidas/audit';
import {
	type AuditLogTable,
	KyselyAuditStorage,
} from '@geekmidas/audit/kysely';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import {
	CamelCasePlugin,
	type Generated,
	Kysely,
	PostgresDialect,
	sql,
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
	vi,
} from 'vitest';
import { z } from 'zod';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import type { MappedAudit } from '../audit';
import { Endpoint, type EndpointContext } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

// Use unique table names to avoid conflicts with parallel tests
const AUDIT_TABLE = 'hono_audit_logs' as const;
const USERS_TABLE = 'hono_audit_users' as const;

// Database schema
interface TestDatabase {
	[AUDIT_TABLE]: AuditLogTable;
	[USERS_TABLE]: {
		id: Generated<number>;
		name: string;
		email: string;
	};
}

// Audit action types
type TestAuditAction =
	| AuditableAction<'user.created', { userId: number; email: string }>
	| AuditableAction<'user.updated', { userId: number; changes: string[] }>
	| AuditableAction<'user.deleted', { userId: number }>;

describe('HonoEndpoint Kysely Audit Integration', () => {
	let db: Kysely<TestDatabase>;
	let auditStorage: KyselyAuditStorage<TestDatabase>;
	let mockLogger: Logger;

	const createMockLogger = (): Logger => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(function (this: Logger) {
			return this;
		}),
	});

	const createServiceDiscovery = () => {
		const envParser = new EnvironmentParser({});
		ServiceDiscovery.reset();
		return ServiceDiscovery.getInstance(envParser);
	};

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

		// Create audit_logs table
		await db.schema
			.createTable(AUDIT_TABLE)
			.ifNotExists()
			.addColumn('id', 'varchar(32)', (col) => col.primaryKey())
			.addColumn('type', 'varchar', (col) => col.notNull())
			.addColumn('operation', 'varchar', (col) => col.notNull())
			.addColumn('table', 'varchar')
			.addColumn('entityId', 'varchar')
			.addColumn('oldValues', 'jsonb')
			.addColumn('newValues', 'jsonb')
			.addColumn('payload', 'jsonb')
			.addColumn('timestamp', 'timestamp', (col) =>
				col.defaultTo(sql`now()`).notNull(),
			)
			.addColumn('actorId', 'varchar')
			.addColumn('actorType', 'varchar')
			.addColumn('actorData', 'jsonb')
			.addColumn('metadata', 'jsonb')
			.execute();

		// Create users table
		await db.schema
			.createTable(USERS_TABLE)
			.ifNotExists()
			.addColumn('id', 'serial', (col) => col.primaryKey())
			.addColumn('name', 'varchar', (col) => col.notNull())
			.addColumn('email', 'varchar', (col) => col.notNull().unique())
			.execute();

		auditStorage = new KyselyAuditStorage({
			db,
			tableName: AUDIT_TABLE,
		});
	});

	beforeEach(() => {
		mockLogger = createMockLogger();
	});

	afterEach(async () => {
		await db.deleteFrom(AUDIT_TABLE).execute();
		await db.deleteFrom(USERS_TABLE).execute();
	});

	afterAll(async () => {
		await db.schema.dropTable(AUDIT_TABLE).ifExists().execute();
		await db.schema.dropTable(USERS_TABLE).ifExists().execute();
		await db.destroy();
	});

	describe('declarative audits with real database', () => {
		it('should write declarative audit to database on successful request', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async () => {
					return { id: 1, email: 'test@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);

			// Verify audit was written to the real database
			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();

			expect(auditsInDb).toHaveLength(1);
			expect(auditsInDb[0].type).toBe('user.created');
			expect(auditsInDb[0].payload).toEqual({
				userId: 1,
				email: 'test@example.com',
			});
		});

		it('should not write audit when handler fails', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async () => {
					throw new Error('Handler failed');
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(500);

			// Verify no audit was written
			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();

			expect(auditsInDb).toHaveLength(0);
		});
	});

	describe('manual audits with real database', () => {
		it('should write manual audits from handler to database', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[],
						Logger,
						unknown,
						TestAuditAction,
						undefined,
						KyselyAuditStorage<TestDatabase>
					>,
				) => {
					// Manual audit in handler - auditor is guaranteed to exist when TAuditStorage is configured
					ctx.auditor.audit('user.created', {
						userId: 42,
						email: 'manual@example.com',
					});

					return { id: 42, email: 'manual@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits: [],
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);

			// Verify manual audit was written
			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();

			expect(auditsInDb).toHaveLength(1);
			expect(auditsInDb[0].type).toBe('user.created');
			expect(auditsInDb[0].payload).toEqual({
				userId: 42,
				email: 'manual@example.com',
			});
		});

		it('should not write manual audit when handler fails after audit call', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[],
						Logger,
						unknown,
						TestAuditAction,
						undefined,
						KyselyAuditStorage<TestDatabase>
					>,
				) => {
					// Manual audit before failure - auditor is guaranteed to exist
					ctx.auditor.audit('user.created', {
						userId: 99,
						email: 'shouldnotexist@example.com',
					});

					// Fail after audit
					throw new Error('Handler failed after audit');
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits: [],
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(500);

			// Verify no audit was written (transaction rolled back)
			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();

			expect(auditsInDb).toHaveLength(0);
		});
	});

	describe('transactional consistency with real database', () => {
		it('should commit both user insert and audit on success', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const databaseService: Service<'database', Kysely<TestDatabase>> = {
				serviceName: 'database' as const,
				register: vi.fn().mockResolvedValue(db),
			};

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[typeof databaseService],
						Logger,
						unknown,
						TestAuditAction,
						undefined,
						KyselyAuditStorage<TestDatabase>
					>,
				) => {
					const database = ctx.services.database;

					// Insert user
					const user = await database
						.insertInto(USERS_TABLE)
						.values({ name: 'Success User', email: 'success@example.com' })
						.returningAll()
						.executeTakeFirstOrThrow();

					// Record audit - auditor is guaranteed to exist
					ctx.auditor.audit('user.created', {
						userId: user.id,
						email: user.email,
					});

					return { id: user.id, email: user.email };
				},
				input: undefined,
				output: outputSchema,
				services: [databaseService],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits: [],
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);

			// Verify user was created
			const usersInDb = await db.selectFrom(USERS_TABLE).selectAll().execute();
			expect(usersInDb).toHaveLength(1);
			expect(usersInDb[0].email).toBe('success@example.com');

			// Verify audit was written
			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();
			expect(auditsInDb).toHaveLength(1);
			expect(auditsInDb[0].type).toBe('user.created');
			expect(auditsInDb[0].payload).toEqual({
				userId: usersInDb[0].id,
				email: 'success@example.com',
			});
		});

		it('should handle combined declarative and manual audits', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			// Declarative audit
			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[],
						Logger,
						unknown,
						TestAuditAction,
						undefined,
						KyselyAuditStorage<TestDatabase>
					>,
				) => {
					// Manual audit - auditor is guaranteed to exist
					ctx.auditor.audit('user.updated', {
						userId: 100,
						changes: ['verified'],
					});

					return { id: 100, email: 'combined@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);

			// Verify both audits were written
			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();

			expect(auditsInDb).toHaveLength(2);

			const auditTypes = auditsInDb.map((a) => a.type).sort();
			expect(auditTypes).toEqual(['user.created', 'user.updated']);
		});
	});

	describe('actor extraction with real database', () => {
		it('should include actor information in audit records', async () => {
			const serviceDiscovery = createServiceDiscovery();

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			const audits: MappedAudit<TestAuditAction, typeof outputSchema>[] = [
				{
					type: 'user.created',
					payload: (response) => ({
						userId: response.id,
						email: response.email,
					}),
				},
			];

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async () => {
					return { id: 1, email: 'actor-test@example.com' };
				},
				input: undefined,
				output: outputSchema,
				services: [],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits,
				actorExtractor: async ({ header }) => {
					const userId = header('x-user-id');
					return {
						id: userId ?? 'anonymous',
						type: userId ? 'user' : 'anonymous',
					};
				},
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: {
					'Content-Type': 'application/json',
					'x-user-id': 'user-123',
				},
			});

			expect(response.status).toBe(201);

			// Verify actor was included in audit
			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();

			expect(auditsInDb).toHaveLength(1);
			expect(auditsInDb[0].actorId).toBe('user-123');
			expect(auditsInDb[0].actorType).toBe('user');
		});
	});

	describe('database service name matching', () => {
		it('should use audit transaction as db when databaseServiceName matches', async () => {
			const serviceDiscovery = createServiceDiscovery();

			// Create audit storage WITH databaseServiceName
			const auditStorageWithServiceName = new KyselyAuditStorage({
				db,
				tableName: AUDIT_TABLE,
				databaseServiceName: 'database', // Matches the database service
			});

			const databaseService: Service<'database', Kysely<TestDatabase>> = {
				serviceName: 'database' as const,
				register: vi.fn().mockResolvedValue(db),
			};

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorageWithServiceName),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			let receivedDbIsTransaction = false;

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[typeof databaseService],
						Logger,
						unknown,
						TestAuditAction,
						Kysely<TestDatabase>,
						KyselyAuditStorage<TestDatabase>
					>,
				) => {
					// Check if db is a transaction (has isTransaction property from Kysely)
					// When databaseServiceName matches, db should be the transaction
					receivedDbIsTransaction = (ctx.db as any)?.isTransaction === true;

					// Insert user using ctx.db (should be the transaction)
					const user = await ctx.db
						.insertInto(USERS_TABLE)
						.values({ name: 'Transaction User', email: 'trx@example.com' })
						.returningAll()
						.executeTakeFirstOrThrow();

					// Record audit
					ctx.auditor.audit('user.created', {
						userId: user.id,
						email: user.email,
					});

					return { id: user.id, email: user.email };
				},
				input: undefined,
				output: outputSchema,
				services: [databaseService],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits: [],
				databaseService,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);
			expect(receivedDbIsTransaction).toBe(true);

			// Verify both user and audit were committed
			const usersInDb = await db.selectFrom(USERS_TABLE).selectAll().execute();
			expect(usersInDb).toHaveLength(1);
			expect(usersInDb[0].email).toBe('trx@example.com');

			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();
			expect(auditsInDb).toHaveLength(1);
		});

		it('should use raw db when databaseServiceName does not match', async () => {
			const serviceDiscovery = createServiceDiscovery();

			// Create audit storage with DIFFERENT databaseServiceName
			const auditStorageWithDifferentServiceName = new KyselyAuditStorage({
				db,
				tableName: AUDIT_TABLE,
				databaseServiceName: 'auditDatabase', // Different from 'database'
			});

			const databaseService: Service<'database', Kysely<TestDatabase>> = {
				serviceName: 'database' as const,
				register: vi.fn().mockResolvedValue(db),
			};

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi
					.fn()
					.mockResolvedValue(auditStorageWithDifferentServiceName),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			let receivedDbIsTransaction = false;

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[typeof databaseService],
						Logger,
						unknown,
						TestAuditAction,
						Kysely<TestDatabase>,
						KyselyAuditStorage<TestDatabase>
					>,
				) => {
					// When databaseServiceName doesn't match, db should be raw (not a transaction)
					receivedDbIsTransaction = (ctx.db as any)?.isTransaction === true;

					// Insert user using ctx.db (should be raw db, not transaction)
					const user = await ctx.db
						.insertInto(USERS_TABLE)
						.values({ name: 'Raw DB User', email: 'raw@example.com' })
						.returningAll()
						.executeTakeFirstOrThrow();

					// Record audit
					ctx.auditor.audit('user.created', {
						userId: user.id,
						email: user.email,
					});

					return { id: user.id, email: user.email };
				},
				input: undefined,
				output: outputSchema,
				services: [databaseService],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits: [],
				databaseService,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);
			// db should NOT be a transaction since service names don't match
			expect(receivedDbIsTransaction).toBe(false);

			// Both should still be committed (but not in the same transaction)
			const usersInDb = await db.selectFrom(USERS_TABLE).selectAll().execute();
			expect(usersInDb).toHaveLength(1);

			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();
			expect(auditsInDb).toHaveLength(1);
		});

		it('should use raw db when databaseServiceName is not set on audit storage', async () => {
			const serviceDiscovery = createServiceDiscovery();

			// Create audit storage WITHOUT databaseServiceName (uses default auditStorage from beforeAll)
			const databaseService: Service<'database', Kysely<TestDatabase>> = {
				serviceName: 'database' as const,
				register: vi.fn().mockResolvedValue(db),
			};

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorage), // No databaseServiceName set
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			let receivedDbIsTransaction = false;

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[typeof databaseService],
						Logger,
						unknown,
						TestAuditAction,
						Kysely<TestDatabase>,
						KyselyAuditStorage<TestDatabase>
					>,
				) => {
					// When databaseServiceName is not set, db should be raw
					receivedDbIsTransaction = (ctx.db as any)?.isTransaction === true;

					const user = await ctx.db
						.insertInto(USERS_TABLE)
						.values({
							name: 'No ServiceName User',
							email: 'noname@example.com',
						})
						.returningAll()
						.executeTakeFirstOrThrow();

					ctx.auditor.audit('user.created', {
						userId: user.id,
						email: user.email,
					});

					return { id: user.id, email: user.email };
				},
				input: undefined,
				output: outputSchema,
				services: [databaseService],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits: [],
				databaseService,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(201);
			expect(receivedDbIsTransaction).toBe(false);

			const usersInDb = await db.selectFrom(USERS_TABLE).selectAll().execute();
			expect(usersInDb).toHaveLength(1);

			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();
			expect(auditsInDb).toHaveLength(1);
		});

		it('should rollback both user insert and audit when handler fails with matching databaseServiceName', async () => {
			const serviceDiscovery = createServiceDiscovery();

			// Create audit storage WITH databaseServiceName
			const auditStorageWithServiceName = new KyselyAuditStorage({
				db,
				tableName: AUDIT_TABLE,
				databaseServiceName: 'database',
			});

			const databaseService: Service<'database', Kysely<TestDatabase>> = {
				serviceName: 'database' as const,
				register: vi.fn().mockResolvedValue(db),
			};

			const auditStorageService: Service<
				'auditStorage',
				KyselyAuditStorage<TestDatabase>
			> = {
				serviceName: 'auditStorage' as const,
				register: vi.fn().mockResolvedValue(auditStorageWithServiceName),
			};

			const outputSchema = z.object({ id: z.number(), email: z.string() });

			const endpoint = new Endpoint({
				route: '/users',
				method: 'POST',
				fn: async (
					ctx: EndpointContext<
						undefined,
						[typeof databaseService],
						Logger,
						unknown,
						TestAuditAction,
						Kysely<TestDatabase>,
						KyselyAuditStorage<TestDatabase>
					>,
				) => {
					// Insert user (should be rolled back)
					const user = await ctx.db
						.insertInto(USERS_TABLE)
						.values({ name: 'Rollback User', email: 'rollback@example.com' })
						.returningAll()
						.executeTakeFirstOrThrow();

					// Record audit (should also be rolled back)
					ctx.auditor.audit('user.created', {
						userId: user.id,
						email: user.email,
					});

					// Fail after both operations
					throw new Error('Simulated failure');
				},
				input: undefined,
				output: outputSchema,
				services: [databaseService],
				logger: mockLogger,
				timeout: undefined,
				memorySize: undefined,
				status: 201,
				getSession: undefined,
				authorize: undefined,
				description: undefined,
				events: [],
				publisherService: undefined,
				auditorStorageService: auditStorageService,
				audits: [],
				databaseService,
			});

			const adaptor = new HonoEndpoint(endpoint);
			const app = new Hono();
			HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
			adaptor.addRoute(serviceDiscovery, app);

			const response = await app.request('/users', {
				method: 'POST',
				body: JSON.stringify({}),
				headers: { 'Content-Type': 'application/json' },
			});

			expect(response.status).toBe(500);

			// Both should be rolled back since they're in the same transaction
			const usersInDb = await db.selectFrom(USERS_TABLE).selectAll().execute();
			expect(usersInDb).toHaveLength(0);

			const auditsInDb = await db.selectFrom(AUDIT_TABLE).selectAll().execute();
			expect(auditsInDb).toHaveLength(0);
		});
	});
});
