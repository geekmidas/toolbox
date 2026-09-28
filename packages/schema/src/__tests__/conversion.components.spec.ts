import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
	convertSchemaWithComponents,
	convertStandardSchemaToJsonSchema,
	getRegisteredZodJsonSchemas,
} from '../conversion';

/** A component collector like the OpenAPI builder's. */
function collector() {
	const schemas: Record<string, unknown> = {};
	return {
		schemas,
		addSchema(id: string, schema: unknown) {
			schemas[id] = schema;
		},
		getReference(id: string) {
			return { $ref: `#/components/schemas/${id}` };
		},
	};
}

const Address = z
	.object({ street: z.string(), city: z.string() })
	.meta({ id: 'ComponentsSpecAddress' });

const Customer = z.object({
	name: z.string(),
	address: Address,
	previous: z.array(Address),
});

describe('$defs extraction', () => {
	it('moves definitions into components and points references at them', async () => {
		const components = collector();

		const json = await convertStandardSchemaToJsonSchema(Customer, components);

		expect(json.$defs).toBeUndefined();
		expect(json.properties.address).toEqual({
			$ref: '#/components/schemas/ComponentsSpecAddress',
		});
		expect(json.properties.previous.items).toEqual({
			$ref: '#/components/schemas/ComponentsSpecAddress',
		});
		expect(components.schemas.ComponentsSpecAddress).toMatchObject({
			type: 'object',
			required: ['street', 'city'],
		});
	});

	it('leaves references alone when there is nowhere to put components', async () => {
		const json = await convertStandardSchemaToJsonSchema(Customer);

		expect(json.$defs).toBeUndefined();
		expect(json.properties.address.$ref).toBe('#/$defs/ComponentsSpecAddress');
	});

	it('keeps a reference that does not point into $defs', async () => {
		type Node = { children: Node[] };
		const Tree: z.ZodType<Node> = z.lazy(() =>
			z.object({ children: z.array(Tree) }),
		);

		const json = await convertStandardSchemaToJsonSchema(
			Tree as never,
			collector(),
		);

		expect(JSON.stringify(json)).toContain('"$ref":"#"');
	});
});

describe('convertSchemaWithComponents', () => {
	it('registers a schema with an id and returns a reference to it', async () => {
		const components = collector();

		const ref = await convertSchemaWithComponents(Address, components);

		expect(ref).toEqual({
			$ref: '#/components/schemas/ComponentsSpecAddress',
		});
		expect(components.schemas.ComponentsSpecAddress).not.toHaveProperty('id');
	});

	it('returns the schema itself when it has no id', async () => {
		const json = await convertSchemaWithComponents(
			z.object({ n: z.number() }),
			collector(),
		);

		expect(json).toMatchObject({ type: 'object' });
	});

	it('returns undefined for no schema', async () => {
		expect(await convertSchemaWithComponents(undefined)).toBeUndefined();
	});
});

describe('getRegisteredZodJsonSchemas', () => {
	it('returns every schema registered with an id', async () => {
		z.object({ sku: z.string() }).meta({ id: 'ComponentsSpecProduct' });

		const schemas = await getRegisteredZodJsonSchemas();

		expect(schemas.ComponentsSpecProduct).toMatchObject({
			type: 'object',
			properties: { sku: { type: 'string' } },
		});
	});
});
