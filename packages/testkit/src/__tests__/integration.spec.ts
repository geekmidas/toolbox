import { it as base, beforeAll, describe, expect } from 'vitest';
import { TEST_DATABASE_CONFIG } from '../../test/globalSetup';
import { type TestDatabase, createTestTables } from '../../test/helpers';
import { KyselyFactory } from '../KyselyFactory';
import { createKyselyDb } from '../helpers';
import { extendWithFixtures, wrapVitestKyselyTransaction } from '../kysely';

const db = () => createKyselyDb<TestDatabase>(TEST_DATABASE_CONFIG);
const it = wrapVitestKyselyTransaction<TestDatabase>(
  base,
  db,
  createTestTables,
);
describe('Testkit Integration Tests', () => {
  beforeAll(async () => {});
  describe('Complex Factory Scenarios', () => {
    it('should handle complex multi-table data creation', async ({ trx }) => {
      // Create builders for all entities
      const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
        'users',
        async () => ({
          name: 'John Doe',
          email: `user${Date.now()}-${Math.random()}@example.com`,
          role: 'user' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const postBuilder = KyselyFactory.createBuilder<TestDatabase, 'posts'>(
        'posts',
        async ({ attrs, factory }) => {
          // Create a user if no userId provided
          if (!attrs.userId) {
            const user = await factory.insert('user');
            return {
              title: 'Default Post Title',
              content: 'Default post content...',
              userId: user.id,
              published: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          }
          return {
            title: 'Default Post Title',
            content: 'Default post content...',
            published: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      );

      const commentBuilder = KyselyFactory.createBuilder<
        TestDatabase,
        'comments'
      >('comments', async ({ attrs, factory }) => {
        let postId = attrs.postId;
        let userId = attrs.userId;

        // Create post if not provided
        if (!postId) {
          const post = await factory.insert('post');
          postId = post.id;
        }

        // Create user if not provided
        if (!userId) {
          const user = await factory.insert('user');
          userId = user.id;
        }

        return {
          content: 'Default comment content',
          postId,
          userId,
          createdAt: new Date(),
        };
      });

      const builders = {
        user: userBuilder,
        post: postBuilder,
        comment: commentBuilder,
      };

      const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
        builders,
        {},
        trx,
      );

      // Create a complete blog structure
      const author = await factory.insert('user', {
        name: 'Jane Author',
        email: 'jane@author.com',
        role: 'admin',
      });

      const posts = await factory.insertMany(3, 'post', (idx) => ({
        title: `Post ${idx + 1}`,
        content: `Content for post ${idx + 1}`,
        userId: author.id,
        published: idx < 2, // First two posts are published
      }));

      // Create comments on the first post
      const comments = await factory.insertMany(5, 'comment', (idx) => ({
        content: `Comment ${idx + 1} on first post`,
        postId: posts[0].id,
      }));

      // Verify the data structure
      expect(author.name).toBe('Jane Author');
      expect(author.role).toBe('admin');

      expect(posts).toHaveLength(3);
      expect(posts[0].title).toBe('Post 1');
      expect(posts[0].published).toBe(true);
      expect(posts[2].published).toBe(false);

      expect(comments).toHaveLength(5);
      comments.forEach((comment, idx) => {
        expect(comment.content).toBe(`Comment ${idx + 1} on first post`);
        expect(comment.postId).toBe(posts[0].id);
      });

      // Verify relationships in database
      const authorPosts = await trx
        .selectFrom('posts')
        .selectAll()
        .where('userId', '=', author.id)
        .execute();

      expect(authorPosts).toHaveLength(3);

      const firstPostComments = await trx
        .selectFrom('comments')
        .selectAll()
        .where('postId', '=', posts[0].id)
        .execute();

      expect(firstPostComments).toHaveLength(5);
    });

    it('should handle seeds for complex scenarios', async ({ trx }) => {
      const c = await trx
        .selectFrom('users')
        .select(trx.fn.count('id').as('count'))
        .executeTakeFirst();

      const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
        'users',
        async () => ({
          name: 'Default User',
          email: `user${Date.now()}-${Math.random()}@example.com`,
          role: 'user' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const postBuilder = KyselyFactory.createBuilder<TestDatabase, 'posts'>(
        'posts',
        async ({ attrs, factory }) => {
          if (!attrs.userId) {
            const user = await factory.insert('user');
            return {
              title: 'Default Post',
              content: 'Default content',
              userId: user.id,
              published: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          }
          return {
            title: 'Default Post',
            content: 'Default content',
            published: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      );

      const builders = {
        user: userBuilder,
        post: postBuilder,
      };

      // Create complex seeds
      const seeds = {
        blogWithAdminAndPosts: KyselyFactory.createSeed(
          async (
            attrs: { postCount?: number },
            factory: KyselyFactory<TestDatabase, typeof builders, {}>,
          ) => {
            // Create admin user
            const admin = await factory.insert('user', {
              name: 'Blog Admin',
              email: 'admin@blog.com',
              role: 'admin',
            });

            // Create multiple posts
            const postCount = attrs.postCount || 3;
            const posts = await factory.insertMany(
              postCount,
              'post',
              (idx) => ({
                title: `Admin Post ${idx + 1}`,
                content: `Content for admin post ${idx + 1}`,
                userId: admin.id,
                published: true,
              }),
            );

            return {
              admin,
              posts,
              summary: {
                adminId: admin.id,
                postIds: posts.map((p) => p.id),
                totalPosts: posts.length,
              },
            };
          },
        ),

        usersWithPosts: KyselyFactory.createSeed(
          async (
            attrs: { userCount?: number; postsPerUser?: number },
            factory: KyselyFactory<TestDatabase, typeof builders, {}>,
          ) => {
            const userCount = attrs.userCount || 2;
            const postsPerUser = attrs.postsPerUser || 2;

            const results: Array<{
              user: Awaited<ReturnType<typeof builders.user>>;
              posts: Awaited<ReturnType<typeof builders.post>>[];
            }> = [];

            for (let i = 0; i < userCount; i++) {
              const user = await factory.insert('user', {
                name: `User ${i + 1}`,
                email: `user${i + 1}@example.com`,
              });

              const posts = await factory.insertMany(
                postsPerUser,
                'post',
                (postIdx) => ({
                  title: `User ${i + 1} Post ${postIdx + 1}`,
                  content: `Content from user ${i + 1}, post ${postIdx + 1}`,
                  userId: user.id,
                  published: postIdx === 0, // Only first post is published
                }),
              );

              results.push({ user, posts });
            }

            return results;
          },
        ),
      };

      const factory = new KyselyFactory<
        TestDatabase,
        typeof builders,
        typeof seeds
      >(builders, seeds, trx);

      // Test first seed
      const blogData = await factory.seed('blogWithAdminAndPosts', {
        postCount: 5,
      });

      expect(blogData.admin.name).toBe('Blog Admin');
      expect(blogData.admin.role).toBe('admin');
      expect(blogData.posts).toHaveLength(5);
      expect(blogData.summary.totalPosts).toBe(5);

      // Test second seed
      const userData = await factory.seed('usersWithPosts', {
        userCount: 3,
        postsPerUser: 4,
      });

      expect(userData).toHaveLength(3);

      // Verify total counts in database
      const totalUsers = await trx
        .selectFrom('users')
        .select(trx.fn.count('id').as('count'))
        .executeTakeFirst();

      const totalPosts = await trx
        .selectFrom('posts')
        .select(trx.fn.count('id').as('count'))
        .executeTakeFirst();

      // 1 admin + 3 users = 4 total users
      expect(Number(totalUsers?.count)).toBe(4);
      // 5 admin posts + (3 users * 4 posts) = 17 total posts
      expect(Number(totalPosts?.count)).toBe(17);
    });

    it('should handle transaction isolation properly', async ({ trx }) => {
      const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
        'users',
        async ({ faker }) => ({
          name: 'Test User',
          email: faker.internet.email(),
          role: 'user' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const builders = { user: userBuilder };

      const factory1 = new KyselyFactory<TestDatabase, typeof builders, {}>(
        builders,
        {},
        trx,
      );

      // Create user in transaction
      const user = await factory1.insert('user', {
        name: 'Transaction User',
        email: 'transaction@test.com',
      });

      // Verify user exists in transaction
      const userInTrx = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirst();

      expect(userInTrx).toBeDefined();
      expect(userInTrx?.name).toBe('Transaction User');
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle creating many records efficiently', async ({ trx }) => {
      const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
        'users',
        async ({ faker }) => ({
          name: `User ${Math.random()}`,
          email: faker.internet.email().toLowerCase(),
          role: 'user' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const builders = { user: userBuilder };
      const factory = new KyselyFactory<TestDatabase, typeof builders, {}>(
        builders,
        {},
        trx,
      );

      const startTime = Date.now();

      // Create 100 users
      const users = await factory.insertMany(100, 'user');

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(users).toHaveLength(100);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds

      // Verify all users are unique
      const emails = users.map((u) => u.email);
      const uniqueEmails = new Set(emails);
      expect(uniqueEmails.size).toBe(100);
    });

    it('should handle complex attribute generation', async ({ trx }) => {
      const userBuilder = KyselyFactory.createBuilder<TestDatabase, 'users'>(
        'users',
        async ({ attrs, faker }) => {
          return {
            name: `Generated User ${attrs.id}`,
            email: faker.internet.email().toLowerCase(),
            role: 'user',
          };
        },
      );

      const postBuilder = KyselyFactory.createBuilder<TestDatabase, 'posts'>(
        'posts',
        async ({ attrs, factory }) => {
          let userId = attrs.userId;
          if (!userId) {
            const user = await factory.insert('user');
            userId = user.id;
          }

          return {
            title: `Auto-generated Post`,
            content: `This is auto-generated content for post. Lorem ipsum dolor sit amet.`,
            published: true,
            userId,
            createdAt: new Date(),
            updatedAt: new Date(),
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

      // Create posts which will auto-create users
      const posts = await factory.insertMany(10, 'post', (i) => ({
        published: i % 2 === 0,
      }));

      expect(posts).toHaveLength(10);

      // Check email normalization
      const users = await trx.selectFrom('users').selectAll().execute();

      users.forEach((user) => {
        expect(user.email).toBe(user.email.toLowerCase());
        expect(user.name).not.toMatch(/^\s|\s$/); // No leading/trailing spaces
      });

      // Check published pattern
      const publishedPosts = posts.filter((p) => p.published);
      const unpublishedPosts = posts.filter((p) => !p.published);

      expect(publishedPosts).toHaveLength(5); // Every other post
      expect(unpublishedPosts).toHaveLength(5);
    });
  });
});

describe('extendWithFixtures', () => {
  // Create builders for use in extended fixtures
  const builders = {
    user: KyselyFactory.createBuilder<TestDatabase, 'users'>(
      'users',
      ({ faker }) => ({
        name: faker.person.fullName(),
        email: faker.internet.email().toLowerCase(),
        role: 'user' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    post: KyselyFactory.createBuilder<TestDatabase, 'posts'>(
      'posts',
      async ({ attrs, factory, faker }) => {
        const userId = attrs.userId ?? (await factory.insert('user')).id;
        return {
          title: faker.lorem.sentence(),
          content: faker.lorem.paragraphs(),
          userId,
          published: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    ),
  };

  // Create base test with transaction
  const baseTest = wrapVitestKyselyTransaction<TestDatabase>(
    base,
    db,
    createTestTables,
  );

  // Extend with factory fixture
  const itWithFactory = extendWithFixtures<
    TestDatabase,
    { factory: KyselyFactory<TestDatabase, typeof builders, {}> }
  >(baseTest, {
    factory: (trx) => new KyselyFactory(builders, {}, trx),
  });

  itWithFactory(
    'should provide factory fixture alongside trx',
    async ({ trx, factory }) => {
      // Both trx and factory should be available
      expect(trx).toBeDefined();
      expect(factory).toBeDefined();
      expect(factory).toBeInstanceOf(KyselyFactory);

      // Factory should work with the transaction
      const user = await factory.insert('user', { name: 'Test User' });
      expect(user.id).toBeDefined();
      expect(user.name).toBe('Test User');

      // Verify user exists in transaction
      const found = await trx
        .selectFrom('users')
        .where('id', '=', user.id)
        .selectAll()
        .executeTakeFirst();

      expect(found).toBeDefined();
      expect(found?.name).toBe('Test User');
    },
  );

  itWithFactory(
    'should allow factory to create related records',
    async ({ factory }) => {
      // Create user first
      const user = await factory.insert('user', {
        name: 'Author',
        email: 'author@example.com',
      });

      // Create posts for the user
      const posts = await factory.insertMany(3, 'post', (idx: number) => ({
        title: `Post ${idx + 1}`,
        userId: user.id,
        published: idx === 0,
      }));

      expect(posts).toHaveLength(3);
      expect(posts[0].userId).toBe(user.id);
      expect(posts[0].published).toBe(true);
      expect(posts[1].published).toBe(false);
    },
  );

  // Test with multiple fixtures
  const itWithMultipleFixtures = extendWithFixtures<
    TestDatabase,
    {
      factory: KyselyFactory<TestDatabase, typeof builders, {}>;
      userCount: number;
    }
  >(baseTest, {
    factory: (trx) => new KyselyFactory(builders, {}, trx),
    userCount: () => 42, // Simple fixture that doesn't use trx
  });

  itWithMultipleFixtures(
    'should support multiple fixtures',
    async ({ trx, factory, userCount }) => {
      expect(trx).toBeDefined();
      expect(factory).toBeInstanceOf(KyselyFactory);
      expect(userCount).toBe(42);

      // Use the factory
      const user = await factory.insert('user');
      expect(user.id).toBeDefined();
    },
  );

  // Test async fixture creators
  const itWithAsyncFixture = extendWithFixtures<
    TestDatabase,
    { initialUser: Awaited<ReturnType<typeof builders.user>> }
  >(baseTest, {
    initialUser: async (trx) => {
      // Create a user directly in the fixture
      const factory = new KyselyFactory(builders, {}, trx);
      return factory.insert('user', {
        name: 'Initial User',
        email: 'initial@example.com',
      });
    },
  });

  itWithAsyncFixture(
    'should support async fixture creators',
    async ({ trx, initialUser }) => {
      expect(initialUser).toBeDefined();
      expect(initialUser.name).toBe('Initial User');
      expect(initialUser.email).toBe('initial@example.com');

      // Verify user exists in database
      const found = await trx
        .selectFrom('users')
        .where('id', '=', initialUser.id)
        .selectAll()
        .executeTakeFirst();

      expect(found).toBeDefined();
      expect(found?.id).toBe(initialUser.id);
    },
  );
});
