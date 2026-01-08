import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../test/globalSetup';
import { createTestTables, type TestDatabase } from '../../test/helpers';
import { createKyselyDb } from '../helpers';
import { KyselyFactory } from '../KyselyFactory';
import { wrapVitestKyselyTransaction } from '../kysely';

const db = () => createKyselyDb<TestDatabase>(TEST_DATABASE_CONFIG);
const itWithTransaction = wrapVitestKyselyTransaction<TestDatabase>(it, {
	connection: db,
	setup: createTestTables,
});

const int8TypeId = 20;
pg.types.setTypeParser(int8TypeId, (val) => {
	return parseInt(val, 10);
});
describe('KyselyFactory', () => {
	describe('KyselyFactory.insert', () => {
		itWithTransaction(
			'should insert a record with defaults',
			async ({ trx }) => {
				const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
					'users',
					async ({ attrs }) => ({
						name: 'John Doe',
						email: `user${Date.now()}@example.com`,
						createdAt: new Date(),
					}),
				);

				const builders = {
					user: userBuilder,
				};

				const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
					builders,
					{},
					trx,
				);

				const user = await factory.insert('user');

				expect(user).toBeDefined();
				expect(user.id).toBeDefined();
				expect(user.name).toBe('John Doe');
				expect(user.email).toContain('user');
				expect(user.email).toContain('@example.com');
				expect(user.createdAt).toBeInstanceOf(Date);
			},
		);

		itWithTransaction(
			'should override defaults with provided attributes',
			async ({ trx }) => {
				const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
					'users',
					async ({ attrs }) => ({
						name: 'John Doe',
						email: `user${Date.now()}@example.com`,
						createdAt: new Date(),
					}),
				);

				const builders = {
					user: userBuilder,
				};

				const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
					builders,
					{},
					trx,
				);

				const customEmail = 'custom@test.com';
				const customName = 'Jane Smith';
				const user = await factory.insert('user', {
					email: customEmail,
					name: customName,
				});

				expect(user.name).toBe(customName);
				expect(user.email).toBe(customEmail);
			},
		);

		itWithTransaction('should handle relations', async ({ trx }) => {
			const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
				'users',
				async (attrs) => ({
					name: 'John Doe',
					email: `user${Date.now()}@example.com`,
					createdAt: new Date(),
				}),
			);

			const postBuilder = KyselyFactory.createBuilder<TestDatabase, 'posts'>(
				'posts',
				async ({ attrs, factory }) => {
					// Create a user if userId not provided
					if (!attrs.userId) {
						const user = await factory.insert('user');
						return {
							title: 'Default Post',
							content: 'Default content',
							userId: user.id,
							createdAt: new Date(),
						};
					}
					return {
						title: 'Default Post',
						content: 'Default content',
						createdAt: new Date(),
					};
				},
			);

			const builders = {
				user: userBuilder,
				post: postBuilder,
			};

			const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
				builders,
				{},
				trx,
			);

			const post = await factory.insert('post', {
				title: 'Test Post',
			});

			expect(post).toBeDefined();
			expect(post.title).toBe('Test Post');
			expect(post.userId).toBeDefined();
			expect(typeof post.userId).toBe('number');
		});

		itWithTransaction(
			'should throw error for non-existent builder',
			async ({ trx }) => {
				const factory = new KyselyFactory<TestDatabase, any, {}>({}, {}, trx);

				await expect(factory.insert('nonExistent' as any)).rejects.toThrow(
					'Factory "nonExistent" does not exist',
				);
			},
		);
	});

	describe('KyselyFactory.insertMany', () => {
		itWithTransaction(
			'should insert multiple records with same attributes',
			async ({ trx }) => {
				const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
					'users',
					async () => ({
						name: 'John Doe',
						email: `user${Date.now()}-${Math.random()}@example.com`,
						createdAt: new Date(),
					}),
				);

				const builders = {
					user: userBuilder,
				};

				const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
					builders,
					{},
					trx,
				);

				const users = await factory.insertMany(3, 'user');

				expect(users).toHaveLength(3);
				users.forEach((user, index) => {
					expect(user.id).toBeDefined();
					expect(user.name).toBe('John Doe');
					expect(user.email).toContain('@example.com');
				});
			},
		);

		itWithTransaction(
			'should insert multiple records with dynamic attributes',
			async ({ trx }) => {
				const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
					'users',
					async () => ({
						email: `user${Date.now()}-${Math.random()}@example.com`,
						createdAt: new Date(),
					}),
				);

				const builders = {
					user: userBuilder,
				};

				const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
					builders,
					{},
					trx,
				);

				const users = await factory.insertMany(3, 'user', (idx) => ({
					name: `User ${idx}`,
				}));

				expect(users).toHaveLength(3);
				users.forEach((user, index) => {
					expect(user.name).toBe(`User ${index}`);
				});
			},
		);

		itWithTransaction(
			'should throw error for non-existent builder',
			async ({ trx }) => {
				const factory = new KyselyFactory<TestDatabase, any, {}>({}, {}, trx);

				await expect(
					factory.insertMany(2, 'nonExistent' as any),
				).rejects.toThrow('Builder "nonExistent" is not registered');
			},
		);
	});

	describe('KyselyFactory.createBuilder', () => {
		itWithTransaction('should work with async defaults', async ({ trx }) => {
			let counter = 0;
			const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
				'users',
				async () => {
					// Simulate async operation
					await new Promise((resolve) => setTimeout(resolve, 10));
					counter++;
					return {
						name: `Async User ${counter}`,
						email: `user${counter}@example.com`,
						createdAt: new Date(),
					};
				},
			);

			const builders = {
				user: userBuilder,
			};

			const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
				builders,
				{},
				trx,
			);

			const user1 = await factory.insert('user');
			const user2 = await factory.insert('user');

			expect(user1.name).toBe('Async User 1');
			expect(user2.name).toBe('Async User 2');
		});
	});

	describe('KyselyFactory.seed', () => {
		itWithTransaction('should execute seed functions', async ({ trx }) => {
			const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
				'users',
				async (attrs) => ({
					name: 'John Doe',
					email: `user${Date.now()}@example.com`,
					createdAt: new Date(),
				}),
			);

			const builders = {
				user: userBuilder,
			};

			const seeds = {
				createAdminUser: KyselyFactory.createSeed(
					async ({
						attrs,
						factory,
					}: {
						attrs: { name?: string };
						factory: any;
						db: any;
					}) => {
						return await factory.insert('user', {
							name: attrs.name || 'Admin User',
							email: 'admin@example.com',
						});
					},
				),
			};

			const factory = new KyselyFactory<
				TestDatabase,
				typeof builders,
				typeof seeds
			>(builders, seeds, trx);

			const adminUser = await factory.seed('createAdminUser');

			expect(adminUser).toBeDefined();
			expect(adminUser.name).toBe('Admin User');
			expect(adminUser.email).toBe('admin@example.com');
		});

		itWithTransaction(
			'should pass attributes to seed functions',
			async ({ trx }) => {
				const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
					'users',
					async ({ attrs }) => ({
						name: 'John Doe',
						email: `user${Date.now()}@example.com`,
						createdAt: new Date(),
					}),
				);

				const builders = {
					user: userBuilder,
				};

				const seeds = {
					createCustomUser: KyselyFactory.createSeed(
						async ({
							attrs,
							factory,
						}: {
							attrs: { name: string; email: string };
							factory: any;
							db: any;
						}) => {
							return await factory.insert('user', attrs);
						},
					),
				};

				const factory = new KyselyFactory<
					TestDatabase,
					typeof builders,
					typeof seeds
				>(builders, seeds, trx);

				const customUser = await factory.seed('createCustomUser', {
					name: 'Custom User',
					email: 'custom@test.com',
				});

				expect(customUser.name).toBe('Custom User');
				expect(customUser.email).toBe('custom@test.com');
			},
		);

		itWithTransaction(
			'should throw error for non-existent seed',
			async ({ trx }) => {
				const factory = new KyselyFactory<TestDatabase, any, any>({}, {}, trx);

				expect(() => factory.seed('nonExistent' as any)).toThrow(
					'Seed "nonExistent" is not registered',
				);
			},
		);
	});

	describe('Factory integration', () => {
		itWithTransaction(
			'should work with controlled transactions',
			async ({ trx }) => {
				const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
					'users',
					async ({ attrs }) => ({
						name: 'John Doe',
						email: `user${Date.now()}@example.com`,
						createdAt: new Date(),
					}),
				);

				const builders = {
					user: userBuilder,
				};

				const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
					builders,
					{},
					trx,
				);

				const user = await factory.insert('user');

				// Verify the user exists in the transaction
				const foundUser = await trx
					.selectFrom('users')
					.selectAll()
					.where('id', '=', user.id)
					.executeTakeFirst();

				expect(foundUser).toBeDefined();
				expect(foundUser?.id).toBe(user.id);
			},
		);

		itWithTransaction(
			'should work with factory passed to defaults',
			async ({ trx }) => {
				const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
					'users',
					async ({ attrs }) => ({
						name: 'John Doe',
						email: `user${Date.now()}@example.com`,
						createdAt: new Date(),
					}),
				);

				const postBuilder = KyselyFactory.createBuilder<TestDatabase, 'posts'>(
					'posts',
					async ({ factory }) => {
						const user = await factory.insert('user');
						return {
							title: 'Default Post',
							content: 'Default content',
							userId: user.id,
							createdAt: new Date(),
						};
					},
				);

				const builders = {
					user: userBuilder,
					post: postBuilder,
				};

				const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
					builders,
					{},
					trx,
				);

				const post = await factory.insert('post');

				expect(post.userId).toBeDefined();

				// Verify the related user exists
				const relatedUser = await trx
					.selectFrom('users')
					.selectAll()
					.where('id', '=', post.userId)
					.executeTakeFirst();

				expect(relatedUser).toBeDefined();
			},
		);
	});
});
