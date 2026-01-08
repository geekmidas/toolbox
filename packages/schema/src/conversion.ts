import type { StandardSchemaV1 } from '@standard-schema/spec';

export enum SchemaVendor {
	zod = 'zod',
	valibot = 'valibot',
}

export type VendorConvertor = (schema: any) => Promise<any>;
export type VendorConvertors = Record<SchemaVendor, VendorConvertor>;

function isSchemaVendor(vendor?: string): vendor is SchemaVendor {
	if (!vendor) {
		return false;
	}

	return Object.values(SchemaVendor).includes(vendor as SchemaVendor);
}

export const StandardSchemaJsonSchema: VendorConvertors = {
	zod: async (schema): Promise<any> => {
		try {
			const { z } = await import('zod/v4').catch(() => ({ z: {} }));

			if ('toJSONSchema' in z && typeof z.toJSONSchema === 'function') {
				return z.toJSONSchema(schema);
			}
			const { zodToJsonSchema } = await import('zod-to-json-schema');

			const result = zodToJsonSchema(schema, {
				removeAdditionalStrategy: 'strict',
			});

			return result;
		} catch {
			// Fallback to basic conversion if zod-to-json-schema is not available
			return { type: 'object' };
		}
	},
	valibot: async (schema): Promise<any> => {
		const { toJsonSchema } = await import('@valibot/to-json-schema');
		return toJsonSchema(schema as any);
	},
};

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
			if (key === '$defs') {
				// Skip $defs as they've been extracted
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

	const vendor = schema['~standard']?.vendor;
	if (!isSchemaVendor(vendor)) {
		throw new Error(
			`Unsupported or missing vendor "${vendor}" for Standard Schema. Supported vendors are: ${Object.keys(StandardSchemaJsonSchema).join(', ')}`,
		);
	}

	const toJSONSchema = StandardSchemaJsonSchema[vendor];
	const jsonSchema = await toJSONSchema(schema);

	// Extract and convert $defs to components
	return extractAndConvertDefs(jsonSchema, componentCollector);
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
		// Remove the id from the schema before adding to components
		const { id, ...schemaWithoutId } = jsonSchema;
		// Add this schema to components and return a reference
		componentCollector.addSchema(schemaId, schemaWithoutId);
		return componentCollector.getReference(schemaId);
	}

	return jsonSchema;
}
