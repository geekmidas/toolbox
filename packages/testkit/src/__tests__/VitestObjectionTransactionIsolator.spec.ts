import { Model } from 'objection';
import { it as base, describe, expect } from 'vitest';

import { createKnexDb, createTestTablesKnex } from '../../test/helpers';
import { wrapVitestObjectionTransaction } from '../objection';

// Define Objection models for testing
class User extends Model {
	static get tableName() {
		return 'users';
	}

	id!: number;
	name!: string;
	createdAt!: Date;
	updatedAt?: Date;

	static get relationMappings() {
		return {
			posts: {
				relation: Model.HasManyRelation,
				modelClass: Post,
				join: {
					from: 'users.id',
					to: 'posts.user_id',
				},
			},
			comments: {
				relation: Model.HasManyRelation,
				modelClass: Comment,
				join: {
					from: 'users.id',
					to: 'comments.user_id',
				},
			},
		};
	}
}

class Post extends Model {
	static get tableName() {
		return 'posts';
	}

	id!: number;
	title!: string;
	content!: string;
	userId!: number;
	published?: boolean;
	createdAt!: Date;
	updatedAt?: Date;

	static get relationMappings() {
		return {
			user: {
				relation: Model.BelongsToOneRelation,
				modelClass: User,
				join: {
					from: 'posts.user_id',
					to: 'users.id',
				},
			},
			comments: {
				relation: Model.HasManyRelation,
				modelClass: Comment,
				join: {
					from: 'posts.id',
					to: 'comments.post_id',
				},
			},
		};
	}
}

class Comment extends Model {
	static get tableName() {
		return 'comments';
	}

	id!: number;
	content!: string;
	postId!: number;
	userId!: number;
	createdAt!: Date;

	static get relationMappings() {
		return {
			post: {
				relation: Model.BelongsToOneRelation,
				modelClass: Post,
				join: {
					from: 'comments.post_id',
					to: 'posts.id',
				},
			},
			user: {
				relation: Model.BelongsToOneRelation,
				modelClass: User,
				join: {
					from: 'comments.user_id',
					to: 'users.id',
				},
			},
		};
	}
}

// Create database connection

// Create wrapped test with transaction isolation
const it = wrapVitestObjectionTransaction(base, {
	connection: createKnexDb,
	setup: async (trx) => {
		// Create tables in the transaction
		await createTestTablesKnex(trx);
	},
});

describe('VitestObjectionTransactionIsolator', () => {
	describe('Transaction Isolation', () => {
		it('should rollback data after test completes', async ({ trx }) => {
			// Create a user within the transaction
			const user = await User.query(trx).insert({
				name: 'Test User',
			});

			expect(user).toBeDefined();
			expect(user.id).toBeDefined();
			expect(user.name).toBe('Test User');

			// Verify user exists in transaction
			const foundUser = await User.query(trx).findById(user.id);
			expect(foundUser).toBeDefined();

			// Data will be rolled back after this test
		});
	});
});
