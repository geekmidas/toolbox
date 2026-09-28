import { describe, test } from 'vitest';
import { z } from 'zod';
import { convertStandardSchemaToJsonSchema } from '../conversion';

describe('Schema Conversion - Simple', () => {
	const simpleSchema = z.object({
		id: z.string(),
		name: z.string(),
		email: z.email(),
	});

	test('simple object schema', async ({ bench }) => {
		await bench('simple object schema', async () => {
			await convertStandardSchemaToJsonSchema(simpleSchema);
		}).run();
	});

	const primitiveSchema = z.string();
	test('primitive string schema', async ({ bench }) => {
		await bench('primitive string schema', async () => {
			await convertStandardSchemaToJsonSchema(primitiveSchema);
		}).run();
	});

	const arraySchema = z.array(z.string());
	test('array of strings schema', async ({ bench }) => {
		await bench('array of strings schema', async () => {
			await convertStandardSchemaToJsonSchema(arraySchema);
		}).run();
	});
});

describe('Schema Conversion - Complex', () => {
	const nestedSchema = z.object({
		user: z.object({
			profile: z.object({
				name: z.string(),
				bio: z.string().optional(),
				settings: z.record(z.string(), z.unknown()),
			}),
			contacts: z.array(
				z.object({
					type: z.enum(['email', 'phone']),
					value: z.string(),
				}),
			),
		}),
		metadata: z.object({
			createdAt: z.string(),
			updatedAt: z.string(),
		}),
	});

	test('deeply nested schema', async ({ bench }) => {
		await bench('deeply nested schema', async () => {
			await convertStandardSchemaToJsonSchema(nestedSchema);
		}).run();
	});

	const unionSchema = z.discriminatedUnion('type', [
		z.object({ type: z.literal('text'), content: z.string() }),
		z.object({ type: z.literal('image'), url: z.string() }),
		z.object({
			type: z.literal('video'),
			url: z.string(),
			duration: z.number(),
		}),
	]);

	test('discriminated union schema', async ({ bench }) => {
		await bench('discriminated union schema', async () => {
			await convertStandardSchemaToJsonSchema(unionSchema);
		}).run();
	});

	const largeSchema = z.object(
		Object.fromEntries(
			Array.from({ length: 50 }, (_, i) => [`field${i}`, z.string()]),
		),
	);

	test('large object (50 fields)', async ({ bench }) => {
		await bench('large object (50 fields)', async () => {
			await convertStandardSchemaToJsonSchema(largeSchema);
		}).run();
	});
});

describe('Schema Conversion - With Refinements', () => {
	const refinedSchema = z.object({
		age: z.number().min(0).max(150),
		email: z.email(),
		url: z.string().url(),
		uuid: z.string().uuid(),
	});

	test('schema with refinements', async ({ bench }) => {
		await bench('schema with refinements', async () => {
			await convertStandardSchemaToJsonSchema(refinedSchema);
		}).run();
	});
});
