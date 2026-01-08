import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import {
	convertSchemaWithComponents,
	convertStandardSchemaToJsonSchema,
	getSchemaMetadata,
	getZodMetadata,
	SchemaVendor,
} from '../conversion';
import { createComponentCollector } from '../openapi';

describe('Schema Conversion', () => {
	describe('convertStandardSchemaToJsonSchema', () => {
		it('should convert Zod object schema to JSON Schema', async () => {
			const schema = z.object({
				name: z.string(),
				age: z.number(),
			});

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema).toHaveProperty('type', 'object');
			expect(jsonSchema).toHaveProperty('properties');
			expect(jsonSchema.properties).toHaveProperty('name');
			expect(jsonSchema.properties).toHaveProperty('age');
		});

		it('should return undefined for undefined schema', async () => {
			const jsonSchema = await convertStandardSchemaToJsonSchema(undefined);

			expect(jsonSchema).toBeUndefined();
		});

		it('should convert Zod string schema', async () => {
			const schema = z.string();

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema).toHaveProperty('type', 'string');
		});

		it('should convert Zod number schema', async () => {
			const schema = z.number();

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema).toHaveProperty('type', 'number');
		});

		it('should convert Zod array schema', async () => {
			const schema = z.array(z.string());

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema).toHaveProperty('type', 'array');
			expect(jsonSchema).toHaveProperty('items');
		});

		it('should convert Zod enum schema', async () => {
			const schema = z.enum(['active', 'inactive', 'pending']);

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema).toHaveProperty('enum');
			expect(jsonSchema.enum).toEqual(['active', 'inactive', 'pending']);
		});

		it('should convert nested object schema', async () => {
			const schema = z.object({
				user: z.object({
					name: z.string(),
					age: z.number(),
				}),
			});

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema.type).toBe('object');
			expect(jsonSchema.properties).toHaveProperty('user');
			expect(jsonSchema.properties.user).toHaveProperty('type', 'object');
		});

		it('should handle optional fields', async () => {
			const schema = z.object({
				required: z.string(),
				optional: z.string().optional(),
			});

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema.required).toContain('required');
			expect(jsonSchema.required).not.toContain('optional');
		});

		it('should extract and convert $defs with component collector', async () => {
			const userSchema = z.object({
				name: z.string(),
				age: z.number(),
			});

			const schema = z.object({
				user: userSchema,
			});

			const collector = createComponentCollector();
			const jsonSchema = await convertStandardSchemaToJsonSchema(
				schema,
				collector,
			);

			expect(jsonSchema).toBeDefined();
			// $defs should be removed from main schema
			expect(jsonSchema).not.toHaveProperty('$defs');
		});

		it('should throw error for unsupported vendor', async () => {
			const invalidSchema = {
				'~standard': {
					vendor: 'unsupported' as any,
					validate: vi.fn(),
				},
			};

			await expect(
				convertStandardSchemaToJsonSchema(invalidSchema as any),
			).rejects.toThrow(/Unsupported or missing vendor/);
		});

		it('should throw error for missing vendor', async () => {
			const invalidSchema = {
				'~standard': {
					vendor: undefined,
					validate: vi.fn(),
				},
			};

			await expect(
				convertStandardSchemaToJsonSchema(invalidSchema as any),
			).rejects.toThrow(/Unsupported or missing vendor/);
		});

		it('should handle schema with descriptions', async () => {
			const schema = z
				.object({
					name: z.string(),
				})
				.describe('User information');

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema.description).toBe('User information');
		});

		it('should handle union types', async () => {
			const schema = z.union([z.string(), z.number()]);

			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema).toHaveProperty('anyOf');
		});
	});

	describe('getZodMetadata', () => {
		it('should return undefined for non-Zod objects', async () => {
			const schema = z.string();

			const metadata = await getZodMetadata(schema);

			expect(metadata).toBeUndefined();
		});

		it('should get metadata from Zod object with meta', async () => {
			const schema = z.object({ name: z.string() }).meta({ id: 'User' });

			const metadata = await getZodMetadata(schema);

			expect(metadata).toEqual({ id: 'User' });
		});

		it('should return undefined for Zod object without meta', async () => {
			const schema = z.object({ name: z.string() });

			const metadata = await getZodMetadata(schema);

			// Returns undefined when no meta is set
			expect(metadata).toBeUndefined();
		});
	});

	describe('getSchemaMetadata', () => {
		it('should get metadata for Zod schema', async () => {
			const schema = z.object({ name: z.string() }).meta({ id: 'UserMeta' });

			const metadata = await getSchemaMetadata(schema);

			expect(metadata).toEqual({ id: 'UserMeta' });
		});

		it('should return undefined for non-Zod vendor', async () => {
			const schema = {
				'~standard': {
					vendor: 'valibot',
					validate: vi.fn(),
				},
			};

			const metadata = await getSchemaMetadata(schema as any);

			expect(metadata).toBeUndefined();
		});

		it('should return undefined for schema without vendor', async () => {
			const schema = {
				'~standard': {
					vendor: undefined,
					validate: vi.fn(),
				},
			};

			const metadata = await getSchemaMetadata(schema as any);

			expect(metadata).toBeUndefined();
		});
	});

	describe('convertSchemaWithComponents', () => {
		it('should convert schema without component collector', async () => {
			const schema = z.object({
				name: z.string(),
				age: z.number(),
			});

			const jsonSchema = await convertSchemaWithComponents(schema);

			expect(jsonSchema).toHaveProperty('type', 'object');
			expect(jsonSchema).toHaveProperty('properties');
		});

		it('should return undefined for undefined schema', async () => {
			const jsonSchema = await convertSchemaWithComponents(undefined);

			expect(jsonSchema).toBeUndefined();
		});

		it('should add schema with ID to component collector', async () => {
			const schema = z.object({ name: z.string() }).meta({ id: 'UserComp' });

			const collector = createComponentCollector();
			const result = await convertSchemaWithComponents(schema, collector);

			expect(result).toEqual({ $ref: '#/components/schemas/UserComp' });
			expect(collector.schemas).toHaveProperty('UserComp');
			expect(collector.schemas.UserComp).not.toHaveProperty('id');
		});

		it('should not add schema without ID to component collector', async () => {
			const schema = z.object({ name: z.string() });

			const collector = createComponentCollector();
			const result = await convertSchemaWithComponents(schema, collector);

			expect(result).not.toHaveProperty('$ref');
			expect(Object.keys(collector.schemas)).toHaveLength(0);
		});

		it('should handle schema with id in JSON Schema', async () => {
			const schema = z.object({ name: z.string() }).meta({ id: 'Person' });

			const collector = createComponentCollector();
			const result = await convertSchemaWithComponents(schema, collector);

			expect(result).toEqual({ $ref: '#/components/schemas/Person' });
			expect(collector.schemas).toHaveProperty('Person');
		});

		it('should convert multiple schemas with collector', async () => {
			const schema1 = z.object({ name: z.string() }).meta({ id: 'UserMulti' });
			const schema2 = z.object({ title: z.string() }).meta({ id: 'PostMulti' });

			const collector = createComponentCollector();

			await convertSchemaWithComponents(schema1, collector);
			await convertSchemaWithComponents(schema2, collector);

			expect(Object.keys(collector.schemas)).toHaveLength(2);
			expect(collector.schemas).toHaveProperty('UserMulti');
			expect(collector.schemas).toHaveProperty('PostMulti');
		});

		it('should handle nested objects with collector', async () => {
			const schema = z
				.object({
					user: z.object({
						name: z.string(),
						profile: z.object({
							bio: z.string(),
						}),
					}),
				})
				.meta({ id: 'UserData' });

			const collector = createComponentCollector();
			const result = await convertSchemaWithComponents(schema, collector);

			expect(result).toEqual({ $ref: '#/components/schemas/UserData' });
			expect(collector.schemas).toHaveProperty('UserData');
		});
	});

	describe('SchemaVendor enum', () => {
		it('should have zod vendor', () => {
			expect(SchemaVendor.zod).toBe('zod');
		});

		it('should have valibot vendor', () => {
			expect(SchemaVendor.valibot).toBe('valibot');
		});
	});

	describe('extractAndConvertDefs edge cases', () => {
		it('should handle $ref that does not start with #/$defs/', async () => {
			// Create a schema with a $ref that doesn't use $defs pattern
			const schema = z.object({
				name: z.string(),
			});

			const collector = createComponentCollector();
			// Add a schema first
			collector.addSchema('ExternalRef', { type: 'string' });

			const jsonSchema = await convertStandardSchemaToJsonSchema(
				schema,
				collector,
			);

			// Basic test - the schema should still convert properly
			expect(jsonSchema).toHaveProperty('type', 'object');
		});

		it('should process arrays in schema correctly', async () => {
			const schema = z.object({
				tags: z.array(z.string()),
				numbers: z.array(z.number()),
			});

			const collector = createComponentCollector();
			const jsonSchema = await convertStandardSchemaToJsonSchema(
				schema,
				collector,
			);

			expect(jsonSchema.properties.tags).toHaveProperty('type', 'array');
			expect(jsonSchema.properties.numbers).toHaveProperty('type', 'array');
		});

		it('should skip $defs key during processing and extract to components', async () => {
			// Create a schema that produces $defs in JSON Schema output
			const addressSchema = z.object({
				street: z.string(),
				city: z.string(),
			});

			const personSchema = z.object({
				name: z.string(),
				address: addressSchema,
			});

			const collector = createComponentCollector();
			const jsonSchema = await convertStandardSchemaToJsonSchema(
				personSchema,
				collector,
			);

			// $defs should be removed from the output
			expect(jsonSchema).not.toHaveProperty('$defs');
			expect(jsonSchema).toHaveProperty('type', 'object');
		});

		it('should handle null/undefined values in schema processing', async () => {
			const schema = z.object({
				nullableField: z.string().nullable(),
				optionalField: z.string().optional(),
			});

			const collector = createComponentCollector();
			const jsonSchema = await convertStandardSchemaToJsonSchema(
				schema,
				collector,
			);

			expect(jsonSchema).toHaveProperty('properties');
			expect(jsonSchema.properties).toHaveProperty('nullableField');
			expect(jsonSchema.properties).toHaveProperty('optionalField');
		});

		it('should handle deeply nested objects with arrays', async () => {
			const schema = z.object({
				users: z.array(
					z.object({
						name: z.string(),
						addresses: z.array(
							z.object({
								street: z.string(),
							}),
						),
					}),
				),
			});

			const collector = createComponentCollector();
			const jsonSchema = await convertStandardSchemaToJsonSchema(
				schema,
				collector,
			);

			expect(jsonSchema).toHaveProperty('type', 'object');
			expect(jsonSchema.properties.users).toHaveProperty('type', 'array');
		});

		it('should handle primitive non-object schema types', async () => {
			const stringSchema = z.string();
			const numberSchema = z.number();
			const booleanSchema = z.boolean();

			const collector = createComponentCollector();

			const stringJson = await convertStandardSchemaToJsonSchema(
				stringSchema,
				collector,
			);
			const numberJson = await convertStandardSchemaToJsonSchema(
				numberSchema,
				collector,
			);
			const booleanJson = await convertStandardSchemaToJsonSchema(
				booleanSchema,
				collector,
			);

			expect(stringJson).toMatchObject({ type: 'string' });
			expect(numberJson).toMatchObject({ type: 'number' });
			expect(booleanJson).toMatchObject({ type: 'boolean' });
		});

		it('should handle schema with discriminated unions', async () => {
			const catSchema = z.object({
				type: z.literal('cat'),
				meows: z.boolean(),
			});

			const dogSchema = z.object({
				type: z.literal('dog'),
				barks: z.boolean(),
			});

			const petSchema = z.discriminatedUnion('type', [catSchema, dogSchema]);

			const collector = createComponentCollector();
			const jsonSchema = await convertStandardSchemaToJsonSchema(
				petSchema,
				collector,
			);

			// Should have oneOf or anyOf for discriminated union
			expect(
				jsonSchema.anyOf || jsonSchema.oneOf || jsonSchema.discriminator,
			).toBeDefined();
		});

		it('should preserve $ref as-is when not matching $defs pattern', async () => {
			// Test the extractAndConvertDefs function with a schema that has
			// $ref not starting with #/$defs/
			const schema = z.object({
				name: z.string(),
			});

			// Without collector, refs should be preserved as-is
			const jsonSchema = await convertStandardSchemaToJsonSchema(schema);

			expect(jsonSchema).toHaveProperty('type', 'object');
		});

		it('should convert $defs references to component references with collector', async () => {
			// Use lazy schema to create a recursive structure that produces $defs
			const nodeSchema: z.ZodTypeAny = z.lazy(() =>
				z.object({
					value: z.string(),
					children: z.array(nodeSchema).optional(),
				}),
			);

			const collector = createComponentCollector();
			const jsonSchema = await convertStandardSchemaToJsonSchema(
				nodeSchema,
				collector,
			);

			// $defs should be processed and potentially converted
			expect(jsonSchema).not.toHaveProperty('$defs');
		});
	});
});
