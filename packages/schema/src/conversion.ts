import type {
	StandardJSONSchemaV1,
	StandardSchemaV1,
} from '@standard-schema/spec';

/**
 * A schema that does not implement Standard JSON Schema
 * (`~standard.jsonSchema`), so nothing can say what JSON Schema it is.
 */
export class SchemaHasNoJsonSchema extends Error {
	constructor(readonly vendor: string | undefined) {
		super(
			`This ${vendor ? `'${vendor}' ` : ''}schema does not implement Standard ` +
				`JSON Schema (\`~standard.jsonSchema\`), so it cannot be converted to ` +
				`JSON Schema. Use a library that implements it — zod ≥ 4.2 does on ` +
				`every schema — or wrap the schema in its library's adapter, e.g. ` +
				`valibot's \`toStandardJsonSchema(schema)\` from \`@valibot/to-json-schema\`.`,
		);
		this.name = 'SchemaHasNoJsonSchema';
	}
}

/** Whether a schema implements Standard JSON Schema — can say its JSON Schema. */
export function hasJsonSchema(
	schema: StandardSchemaV1,
): schema is StandardSchemaV1 & StandardJSONSchemaV1 {
	const standard = schema['~standard'] as Partial<StandardJSONSchemaV1.Props>;
	return typeof standard?.jsonSchema?.output === 'function';
}

/**
 * A schema's JSON Schema, as the schema itself says — Standard JSON Schema's
 * `~standard.jsonSchema.output`, in draft 2020-12 — with its `$defs` intact.
 *
 * Converted the way the package validates: through the schema's own
 * `~standard`, never a converter per vendor. A converter behind an `import()`
 * is a specifier every bundler resolves, so each one would be a package every
 * app has to install whether or not it uses that library.
 */
export function toJsonSchema(schema: StandardSchemaV1): any {
	if (!hasJsonSchema(schema)) {
		throw new SchemaHasNoJsonSchema(schema['~standard']?.vendor);
	}
	return schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' });
}

function extractAndConvertDefs(
	jsonSchema: any,
	componentCollector?: {
		addSchema(id: string, schema: any): void;
		getReference(id: string): { $ref: string };
	},
): any {
	if (!jsonSchema || typeof jsonSchema !== 'object') {
		return jsonSchema;
	}

	// Process the schema recursively to update references
	const processSchema = (schema: any): any => {
		if (!schema || typeof schema !== 'object') {
			return schema;
		}

		// Handle $ref
		if (schema.$ref && typeof schema.$ref === 'string') {
			// Convert #/$defs/X to #/components/schemas/X
			if (schema.$ref.startsWith('#/$defs/')) {
				const refName = schema.$ref.replace('#/$defs/', '');
				return componentCollector
					? componentCollector.getReference(refName)
					: schema;
			}
			return schema;
		}

		// Handle arrays
		if (Array.isArray(schema)) {
			return schema.map(processSchema);
		}

		// Process all properties recursively
		const processed: any = {};
		for (const [key, value] of Object.entries(schema)) {
			// `$defs` has been extracted. `$schema` names the dialect the converter
			// wrote, which the document declares once for every schema in it; a
			// copy on each one is noise the document does not need.
			if (key === '$defs' || key === '$schema') {
				continue;
			}
			processed[key] = processSchema(value);
		}
		return processed;
	};

	// Extract $defs if present
	if (jsonSchema.$defs && componentCollector) {
		for (const [defName, defSchema] of Object.entries(jsonSchema.$defs)) {
			// Process the definition recursively to handle nested $refs
			const processedDefSchema = processSchema(defSchema);
			// Add each definition to the component collector
			componentCollector.addSchema(defName, processedDefSchema);
		}
	}

	// Process the schema and remove $defs
	const { $defs, ...schemaWithoutDefs } = jsonSchema;
	return processSchema(schemaWithoutDefs);
}

export async function convertStandardSchemaToJsonSchema(
	schema?: StandardSchemaV1,
	componentCollector?: {
		addSchema(id: string, schema: any): void;
		getReference(id: string): { $ref: string };
	},
): Promise<any> {
	if (!schema) {
		return undefined;
	}

	// Extract and convert $defs to components
	return extractAndConvertDefs(toJsonSchema(schema), componentCollector);
}

export async function getZodMetadata(
	schema: StandardSchemaV1,
): Promise<SchemaMeta | undefined> {
	const { ZodObject } = await import('zod/v4');

	if (schema instanceof ZodObject) {
		return schema.meta();
	}

	return undefined;
}

/**
 * Return JSON Schema for every schema registered in zod v4's global registry
 * via `.meta({ id })`. Returns an empty object when zod v4 is unavailable or
 * no schemas are registered.
 *
 * `unrepresentable: 'any'` keeps a single unrepresentable schema from
 * collapsing the whole result.
 */
export async function getRegisteredZodJsonSchemas(): Promise<
	Record<string, any>
> {
	try {
		const { z } = await import('zod/v4').catch(() => ({ z: null as any }));
		if (!z?.toJSONSchema || !z.globalRegistry) {
			return {};
		}
		const result = z.toJSONSchema(z.globalRegistry, {
			unrepresentable: 'any',
		});
		return (result?.schemas ?? {}) as Record<string, any>;
	} catch {
		return {};
	}
}

export async function getSchemaMetadata(
	schema: StandardSchemaV1,
): Promise<SchemaMeta | undefined> {
	const vendor = schema['~standard']?.vendor;

	if (vendor === 'zod') {
		return getZodMetadata(schema);
	}

	return undefined;
}

interface SchemaMeta {
	id?: string;
}

export async function convertSchemaWithComponents(
	schema: StandardSchemaV1 | undefined,
	componentCollector?: {
		addSchema(id: string, schema: any): void;
		getReference(id: string): { $ref: string };
	},
): Promise<any> {
	if (!schema) {
		return undefined;
	}

	// Convert to JSON Schema with component collector to handle $defs
	const jsonSchema = await convertStandardSchemaToJsonSchema(
		schema,
		componentCollector,
	);

	if (!componentCollector) {
		return jsonSchema;
	}

	// Check if this schema has metadata with an ID
	const metadata = await getSchemaMetadata(schema);

	// Also check if the JSON Schema itself has an id field (from Zod's meta)
	const schemaId = metadata?.id || jsonSchema?.id;

	if (schemaId) {
		// Zod 4.6 already turns a registered schema into a `$ref` to its own
		// `$defs` entry, which the conversion above moved into components. Adding
		// that reference under the same id would replace the definition with a
		// pointer to itself — `User: { $ref: '#/components/schemas/User' }` — and
		// leave the document with no User at all.
		if (typeof jsonSchema?.$ref === 'string') {
			return componentCollector.getReference(schemaId);
		}
		// Remove the id from the schema before adding to components
		const { id, ...schemaWithoutId } = jsonSchema;
		// Add this schema to components and return a reference
		componentCollector.addSchema(schemaId, schemaWithoutId);
		return componentCollector.getReference(schemaId);
	}

	return jsonSchema;
}
