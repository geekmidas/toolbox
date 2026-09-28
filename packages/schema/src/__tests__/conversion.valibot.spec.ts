import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
	convertSchemaWithComponents,
	convertStandardSchemaToJsonSchema,
	getSchemaMetadata,
} from '../conversion';

describe('Valibot schemas', () => {
	const User = v.object({
		name: v.string(),
		age: v.optional(v.number()),
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
