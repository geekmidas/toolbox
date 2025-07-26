/**
 * Objection.js-specific exports for test utilities.
 * Provides factory implementation for creating test data with Objection.js ORM.
 * 
 * @example
 * ```typescript
 * import { ObjectionFactory } from '@geekmidas/testkit/objection';
 * import { User, Post } from './models';
 * 
 * // Define builders
 * const builders = {
 *   user: (attrs) => User.fromJson({
 *     id: faker.string.uuid(),
 *     name: faker.person.fullName(),
 *     email: faker.internet.email(),
 *     ...attrs
 *   }),
 *   post: (attrs) => Post.fromJson({
 *     id: faker.string.uuid(),
 *     title: 'Test Post',
 *     content: faker.lorem.paragraph(),
 *     ...attrs
 *   })
 * };
 * 
 * // Define seeds
 * const seeds = {
 *   userWithPosts: async (attrs, factory) => {
 *     const user = await factory.insert('user', attrs);
 *     await factory.insertMany(3, 'post', { userId: user.id });
 *     return user;
 *   }
 * };
 * 
 * // Create factory
 * const factory = new ObjectionFactory(builders, seeds, knex);
 * 
 * // Use in tests
 * const user = await factory.insert('user', { role: 'admin' });
 * const users = await factory.insertMany(5, 'user');
 * const author = await factory.seed('userWithPosts');
 * ```
 */
export { ObjectionFactory } from './ObjectionFactory';
