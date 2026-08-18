import { EnvironmentParser } from '@geekmidas/envkit';
import { type Service, serviceContext } from '@geekmidas/services';
import type { TestAPI } from 'vitest';

/**
 * Type definition for test fixtures that provide transaction access.
 * Used with Vitest's test.extend() API to inject transactions into tests.
 *
 * @template Transaction - The transaction type specific to the database driver
 * @template Extended - Additional context properties provided by the extend function
 */
export interface DatabaseFixtures<Transaction, _Extended = object> {
	/**
	 * The database transaction available to the test.
	 * All database operations should use this transaction to ensure proper rollback.
	 */
	trx: Transaction;
}

/**
 * Combined fixtures type that merges the base transaction fixture with extended context.
 */
export type ExtendedDatabaseFixtures<
	Transaction,
	Extended = object,
> = DatabaseFixtures<Transaction> & Extended;

/**
 * Function type for extending test context with additional properties.
 * Receives the transaction and returns additional context to be merged with { trx }.
 *
 * @template Transaction - The transaction type
 * @template Extended - The type of additional context to provide
 *
 * @example
 * ```typescript
 * const extendContext: ExtendContextFn<Transaction<DB>, { factory: KyselyFactory }> =
 *   (trx) => ({ factory: new KyselyFactory(builders, seeds, trx) });
 * ```
 */
export type ExtendContextFn<Transaction, Extended> = (
	trx: Transaction,
) => Extended | Promise<Extended>;

/**
 * PostgreSQL transaction isolation levels.
 * Controls the visibility of concurrent transactions.
 *
 * @see https://www.postgresql.org/docs/current/transaction-iso.html
 */
export enum IsolationLevel {
	/**
	 * Lowest isolation level. Allows dirty reads.
	 * Not recommended for testing.
	 */
	READ_UNCOMMITTED = 'READ UNCOMMITTED',
	/**
	 * Default PostgreSQL isolation level.
	 * Prevents dirty reads but allows non-repeatable reads.
	 */
	READ_COMMITTED = 'READ COMMITTED',
	/**
	 * Prevents dirty reads and non-repeatable reads.
	 * Recommended for most test scenarios.
	 */
	REPEATABLE_READ = 'REPEATABLE READ',
	/**
	 * Highest isolation level. Prevents all phenomena.
	 * May cause performance overhead in tests.
	 */
	SERIALIZABLE = 'SERIALIZABLE',
}

/**
 * Abstract base class for implementing database transaction isolation in Vitest tests.
 * Provides automatic transaction rollback after each test to maintain test isolation.
 * Subclasses must implement the transact() method for their specific database driver.
 *
 * @template TConn - The database connection type
 * @template Transaction - The transaction type
 *
 * @example
 * ```typescript
 * // Implement for your database driver
 * class MyDatabaseIsolator extends VitestPostgresTransactionIsolator<MyDB, MyTx> {
 *   async transact(conn: MyDB, level: IsolationLevel, fn: (tx: MyTx) => Promise<void>) {
 *     await conn.transaction(level, fn);
 *   }
 * }
 *
 * // Use in tests
 * const isolator = new MyDatabaseIsolator(test);
 * const isolatedTest = isolator.wrapVitestWithTransaction(db);
 *
 * isolatedTest('should create user', async ({ trx }) => {
 *   await trx.insert('users', { name: 'Test' });
 *   // Data is automatically rolled back after test
 * });
 * ```
 */
export abstract class VitestPostgresTransactionIsolator<TConn, Transaction> {
	/**
	 * Abstract method to create a transaction with the specified isolation level.
	 * Must be implemented by subclasses for specific database drivers.
	 *
	 * @param conn - The database connection
	 * @param isolationLevel - The transaction isolation level
	 * @param fn - The function to execute within the transaction
	 * @returns Promise that resolves when the transaction completes
	 */
	abstract transact(
		conn: TConn,
		isolationLevel: IsolationLevel,
		fn: (trx: Transaction) => Promise<void>,
	): Promise<void>;

	abstract destroy(conn: TConn): Promise<void>;
	/**
	 * Creates a new VitestPostgresTransactionIsolator instance.
	 *
	 * @param api - The Vitest test API (usually the `test` export from vitest)
	 */
	constructor(private readonly api: TestAPI) {}

	/**
	 * Creates a wrapped version of Vitest's test API that provides transaction isolation.
	 * Each test will run within a database transaction that is automatically rolled back.
	 *
	 * @param options - Configuration options for transaction wrapping
	 * @returns A wrapped test API with transaction support
	 *
	 * @example
	 * ```typescript
	 * const isolatedTest = isolator.wrapVitestWithTransaction({
	 *   connection: db,
	 *   setup: async (trx) => {
	 *     await trx.insert('settings', { key: 'test', value: 'true' });
	 *   },
	 *   fixtures: {
	 *     factory: (trx) => new Factory(trx),
	 *   },
	 * });
	 *
	 * isolatedTest('test with transaction', async ({ trx, factory }) => {
	 *   const user = await factory.insert('user', { name: 'Test' });
	 *   expect(user).toBeDefined();
	 * });
	 * ```
	 */
	wrapVitestWithTransaction<Extended extends Record<string, unknown> = {}>(
		options: TransactionWrapperOptions<TConn, Transaction, Extended>,
	) {
		const {
			connection,
			setup,
			isolationLevel = IsolationLevel.REPEATABLE_READ,
			fixtures,
		} = options;

		// Resolved once per file, not once per test. The fixture below runs for
		// every test, and opening a pool each time leaves one connection per test
		// alive — a file of fifty tests exhausts the server.
		let resolved: TConn | undefined;
		const resolveConnection = async (): Promise<TConn> => {
			if (resolved === undefined) {
				resolved = await (isConstruct(connection)
					? connection.service.register({
							// Spread: `process.env` is a ProcessEnv, not a plain object.
							envParser: new EnvironmentParser({ ...process.env }),
							context: serviceContext,
						})
					: connection());
			}
			return resolved;
		};

		// Build fixture definitions for additional fixtures that depend on trx
		const additionalFixtures: Record<string, unknown> = {};
		if (fixtures) {
			for (const [key, creator] of Object.entries(fixtures)) {
				additionalFixtures[key] = async (
					{ trx }: { trx: Transaction },
					use: (value: unknown) => Promise<void>,
				) => {
					const value = await (creator as (trx: Transaction) => unknown)(trx);
					await use(value);
				};
			}
		}

		type CombinedFixtures = DatabaseFixtures<Transaction> & Extended;

		// Cast to bypass Vitest's strict fixture typing which can't infer
		// dynamically built fixture objects
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const api = this.api as TestAPI & {
			extend: <T>(fixtures: any) => TestAPI<T>;
		};

		return api.extend<CombinedFixtures>({
			// This fixture automatically provides a transaction to each test
			// biome-ignore lint/correctness/noEmptyPattern: this has to be like this to satisfy Biome
			trx: async ({}: {}, use: (value: Transaction) => Promise<void>) => {
				// Create a custom error class for rollback
				class TestRollback extends Error {
					constructor() {
						super('Test rollback');
						this.name = 'TestRollback';
					}
				}

				let testError: Error | undefined;
				const conn = await resolveConnection();
				try {
					await this.transact(conn, isolationLevel, async (transaction) => {
						try {
							// Provide the transaction to the test
							await setup?.(transaction);
							await use(transaction);
						} catch (error) {
							// Capture any test errors
							testError = error as Error;
						}

						// Always throw to trigger rollback
						throw new TestRollback();
					});
				} catch (error) {
					// Only rethrow if it's not our rollback error
					if (!(error instanceof TestRollback)) {
						throw error;
					}

					// If the test had an error, throw it now
					if (testError) {
						throw testError;
					}
				}
			},
			...additionalFixtures,
		});
	}
}

export type DatabaseConnectionFn<Conn> = () => Conn | Promise<Conn>;

/**
 * Where a connection comes from: a construct, or a function returning one.
 *
 * A construct is preferred, because it builds the client through the same
 * `connect()` production uses. A hand-rolled client missing `CamelCasePlugin`
 * writes `createdAt` where the app writes `created_at`, and the test passes
 * while production does not. The URL is read from `process.env`.
 */
export type DatabaseConnection<Conn> =
	| DatabaseConnectionFn<Conn>
	| ConnectableConstruct<Conn>;

/** A construct is distinguished from a factory by owning a service. */
function isConstruct<Conn>(
	connection: DatabaseConnection<Conn>,
): connection is ConnectableConstruct<Conn> {
	return typeof connection !== 'function';
}

/**
 * Options for wrapping Vitest tests with database transaction isolation.
 */
/**
 * Anything that owns a service handing back a connection — a database
 * construct, structurally, so testkit depends on no construct package.
 */
export interface ConnectableConstruct<TConn> {
	readonly service: Service<string, TConn>;
}

export interface TransactionWrapperOptions<
	TConn,
	Transaction,
	Extended extends Record<string, unknown> = {},
> {
	/** Where the connection comes from — a construct, or a function returning one */
	connection: DatabaseConnection<TConn>;
	/** Optional setup function to run within the transaction before each test */
	setup?: (trx: Transaction) => Promise<void>;
	/** Transaction isolation level (defaults to REPEATABLE_READ) */
	isolationLevel?: IsolationLevel;
	/** Additional fixtures that depend on the transaction */
	fixtures?: FixtureCreators<Transaction, Extended>;
}

/**
 * Type for fixture creator functions that depend on the transaction.
 * Each function receives the transaction and returns the fixture value.
 */
export type FixtureCreators<
	Transaction,
	Extended extends Record<string, unknown>,
> = {
	[K in keyof Extended]: (
		trx: Transaction,
	) => Extended[K] | Promise<Extended[K]>;
};

/**
 * The test API returned by extendWithFixtures.
 * Provides access to both the transaction (trx) and all extended fixtures.
 *
 * @template Transaction - The transaction type
 * @template Extended - The type of additional fixtures provided
 * @template BaseTest - The base wrapped test type
 */
export type TestWithExtendedFixtures<
	Transaction,
	Extended extends Record<string, unknown>,
	BaseTest extends ReturnType<TestAPI['extend']> = ReturnType<
		TestAPI['extend']
	>,
> = BaseTest & {
	<C extends object>(
		name: string,
		fn: (
			context: DatabaseFixtures<Transaction> & Extended & C,
		) => Promise<void>,
	): void;
	<C extends object>(
		name: string,
		options: object,
		fn: (
			context: DatabaseFixtures<Transaction> & Extended & C,
		) => Promise<void>,
	): void;
};

/**
 * Extends a wrapped test API with additional fixtures that depend on the transaction.
 * This allows composing test context with factories, repositories, or other helpers.
 *
 * @template Transaction - The transaction type
 * @template Extended - The type of additional context to provide
 * @param wrappedTest - The base wrapped test from wrapVitestWithTransaction
 * @param fixtures - Object mapping fixture names to creator functions
 * @returns An extended test API with both trx and the additional fixtures
 *
 * @example
 * ```typescript
 * import { wrapVitestKyselyTransaction, extendWithFixtures } from '@geekmidas/testkit/kysely';
 *
 * // Create base wrapped test
 * const baseTest = wrapVitestKyselyTransaction(test, {
 *   connection: db,
 *   setup: createTestTables,
 * });
 *
 * // Extend with fixtures
 * const it = extendWithFixtures(baseTest, {
 *   factory: (trx) => new KyselyFactory(builders, seeds, trx),
 *   userRepo: (trx) => new UserRepository(trx),
 * });
 *
 * // Use in tests - trx and all fixtures are available
 * it('should create user with factory', async ({ trx, factory, userRepo }) => {
 *   const user = await factory.insert('user', { name: 'Test' });
 *   expect(user).toBeDefined();
 * });
 * ```
 */
export function extendWithFixtures<
	Transaction,
	Extended extends Record<string, unknown>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	T extends ReturnType<TestAPI['extend']> = any,
>(
	wrappedTest: T,
	fixtures: FixtureCreators<Transaction, Extended>,
): TestWithExtendedFixtures<Transaction, Extended, T> {
	// Build fixture definitions for Vitest's extend API
	const fixtureDefinitions: Record<string, any> = {};

	for (const [key, creator] of Object.entries(fixtures)) {
		fixtureDefinitions[key] = async (
			{ trx }: { trx: Transaction },
			use: (value: unknown) => Promise<void>,
		) => {
			const value = await (creator as (trx: Transaction) => unknown)(trx);
			await use(value);
		};
	}

	return (wrappedTest as any).extend(fixtureDefinitions);
}
