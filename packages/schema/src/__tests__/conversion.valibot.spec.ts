import { toStandardJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
	convertSchemaWithComponents,
	convertStandardSchemaToJsonSchema,
	getSchemaMetadata,
	SchemaHasNoJsonSchema,
} from '../conversion';

/**
 * Valibot does not implement Standard JSON Schema on its schemas; the app
 * wraps one in valibot's own adapter, and that is the only converter used.
 */
describe('Valibot schemas', () => {
	const bare = v.object({
		name: v.string(),
		age: v.optional(v.number()),
	});
	const User = toStandardJsonSchema(bare);

	it('are refused unwrapped, naming the adapter', async () => {
		const error = await convertStandardSchemaToJsonSchema(bare).catch(
			(caught: unknown) => caught,
		);

		expect(error).toBeInstanceOf(SchemaHasNoJsonSchema);
		expect((error as SchemaHasNoJsonSchema).vendor).toBe('valibot');
		expect((error as Error).message).toContain('toStandardJsonSchema');
	});

	it('convert to JSON Schema', async () => {
		const json = await convertStandardSchemaToJsonSchema(User);

		expect(json).toMatchObject({
			type: 'object',
			properties: { name: { type: 'string' }, age: { type: 'number' } },
			required: ['name'],
		});
	});

	it('carry no Zod metadata, so they are inlined rather than referenced', async () => {
		expect(await getSchemaMetadata(User)).toBeUndefined();

		const registered: string[] = [];
		const json = await convertSchemaWithComponents(User, {
			addSchema(id) {
				registered.push(id);
			},
			getReference(id) {
				return { $ref: id };
			},
		});

		expect(json).toMatchObject({ type: 'object' });
		expect(registered).toEqual([]);
	});
});
