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
			'.': {
				types: './dist/index.d.ts',
				import: './dist/index.js',
			},
			'./*': {
				types: './dist/*.d.ts',
				import: './dist/*.js',
			},
		},
		scripts: {
			build: 'tsc',
			'build:watch': 'tsc --watch',
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			zod: '~4.1.0',
		},
		devDependencies: {
			typescript: '~5.8.2',
		},
	};

	// tsconfig.json for models - extends root
	const tsConfig = {
		extends: '../../tsconfig.json',
		compilerOptions: {
			outDir: './dist',
			rootDir: './src',
		},
		include: ['src/**/*.ts'],
		exclude: ['node_modules', 'dist'],
	};

	// Main index.ts with example schemas
	const indexTs = `import { z } from 'zod';

// ============================================
// Common Schemas
// ============================================

export const idSchema = z.string().uuid();

export const timestampsSchema = z.object({
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  });

// ============================================
// User Schemas
// ============================================

export const userSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().min(1).max(100),
  ...timestampsSchema.shape,
});

export const createUserSchema = userSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateUserSchema = createUserSchema.partial();

// ============================================
// Type Exports
// ============================================

export type Id = z.infer<typeof idSchema>;
export type Timestamps = z.infer<typeof timestampsSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type User = z.infer<typeof userSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
`;

	return [
		{
			path: 'packages/models/package.json',
			content: JSON.stringify(packageJson, null, 2) + '\n',
		},
		{
			path: 'packages/models/tsconfig.json',
			content: JSON.stringify(tsConfig, null, 2) + '\n',
		},
		{
			path: 'packages/models/src/index.ts',
			content: indexTs,
		},
	];
}
