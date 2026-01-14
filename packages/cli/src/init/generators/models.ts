import type { GeneratedFile, TemplateOptions } from '../templates/index.js';

/**
 * Generate packages/models for shared Zod schemas (monorepo only)
 */
export function generateModelsPackage(
	options: TemplateOptions,
): GeneratedFile[] {
	if (!options.monorepo) {
		return [];
	}

	// Package name based on project name
	const packageName = `@${options.name}/models`;

	// package.json for models
	const packageJson = {
		name: packageName,
		version: '0.0.1',
		private: true,
		type: 'module',
		exports: {
			'./*': './src/*.ts',
		},
		scripts: {
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			zod: '~4.1.0',
		},
		devDependencies: {
			typescript: '~5.8.2',
		},
	};

	// tsconfig.json for models - extends root config
	const tsConfig = {
		extends: '../../tsconfig.json',
		compilerOptions: {
			declaration: true,
			declarationMap: true,
			outDir: './dist',
			rootDir: './src',
		},
		include: ['src/**/*.ts'],
		exclude: ['node_modules', 'dist'],
	};

	// common.ts - shared utility schemas
	const commonTs = `import { z } from 'zod';

// ============================================
// Common Schemas
// ============================================

export const IdSchema = z.string().uuid();

export const TimestampsSchema = z.object({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  });

// ============================================
// Type Exports
// ============================================

export type Id = z.infer<typeof IdSchema>;
export type Timestamps = z.infer<typeof TimestampsSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
`;

	// user.ts - user-related schemas
	const userTs = `import { z } from 'zod';
import { IdSchema, TimestampsSchema } from './common.js';

// ============================================
// User Schemas
// ============================================

export const UserSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  name: z.string().min(1).max(100),
  ...TimestampsSchema.shape,
});

export const CreateUserSchema = UserSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateUserSchema = CreateUserSchema.partial();

// ============================================
// Response Schemas
// ============================================

export const UserResponseSchema = UserSchema.pick({
  id: true,
  name: true,
  email: true,
});

export const ListUsersResponseSchema = z.object({
  users: z.array(UserSchema.pick({ id: true, name: true })),
});

// ============================================
// Type Exports
// ============================================

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;
`;

	return [
		{
			path: 'packages/models/package.json',
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{
			path: 'packages/models/tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{
			path: 'packages/models/src/common.ts',
			content: commonTs,
		},
		{
			path: 'packages/models/src/user.ts',
			content: userTs,
		},
	];
}
