import type { OpenAPIV3_1 } from 'openapi-types';

export interface OpenApiSchemaOptions {
	title?: string;
	version?: string;
	description?: string;
	/** A short summary of the API — `info.summary`. */
	summary?: string;
	/** A URL to the terms of service — `info.termsOfService`. */
	termsOfService?: string;
	/** Who to contact about the API — `info.contact`. */
	contact?: OpenAPIV3_1.ContactObject;
	/** The licence the API is offered under — `info.license`. */
	license?: OpenAPIV3_1.LicenseObject;
	/**
	 * The tags operations are grouped under, with their descriptions, in the
	 * order a reference lists them. A tag an operation names that is not here
	 * is listed after these, by name alone.
	 */
	tags?: OpenAPIV3_1.TagObject[];
	/** Where the API is served — one entry per stage, sandbox to production. */
	servers?: OpenAPIV3_1.ServerObject[];
}

export interface ComponentCollector {
	schemas: Record<string, OpenAPIV3_1.SchemaObject>;
	/** The schemes operations name in their `security` requirements. */
	securitySchemes: Record<string, OpenAPIV3_1.SecuritySchemeObject>;
	addSchema(id: string, schema: OpenAPIV3_1.SchemaObject): void;
	addSecurityScheme(
		name: string,
		scheme: OpenAPIV3_1.SecuritySchemeObject,
	): void;
	getReference(id: string): OpenAPIV3_1.ReferenceObject;
}

export function createComponentCollector(): ComponentCollector {
	const schemas: Record<string, OpenAPIV3_1.SchemaObject> = {};
	const securitySchemes: Record<string, OpenAPIV3_1.SecuritySchemeObject> = {};

	return {
		schemas,
		securitySchemes,
		addSchema(id: string, schema: OpenAPIV3_1.SchemaObject) {
			schemas[id] = schema;
		},
		addSecurityScheme(name, scheme) {
			securitySchemes[name] = scheme;
		},
		getReference(id: string): OpenAPIV3_1.ReferenceObject {
			return { $ref: `#/components/schemas/${id}` };
		},
	};
}

/**
 * Builds OpenAPI 3.1 schema from an array of endpoints.
 *
 * Note: This function requires endpoints with toOpenApi3Route method.
 * The actual implementation is in @geekmidas/constructs to avoid circular dependencies.
 */
export async function buildOpenApiSchema(
	endpoints: Array<{
		toOpenApi3Route(collector?: ComponentCollector): Promise<any>;
	}>,
	options: OpenApiSchemaOptions = {},
): Promise<OpenAPIV3_1.Document> {
	const {
		title = 'API',
		version = '1.0.0',
		description,
		summary,
		termsOfService,
		contact,
		license,
		servers,
	} = options;
	const paths: OpenAPIV3_1.PathsObject = {};
	const componentCollector = createComponentCollector();

	for (const endpoint of endpoints) {
		const route = await endpoint.toOpenApi3Route(componentCollector);

		// Merge the route into the paths object
		for (const [path, methods] of Object.entries(route)) {
			if (!paths[path]) {
				paths[path] = {};
			}
			Object.assign(paths[path], methods);
		}
	}

	const doc: OpenAPIV3_1.Document = {
		// 3.1, not 3.0: the schemas are JSON Schema 2020-12 — what Zod 4 and
		// Valibot emit — and 3.1 is the version whose schema objects are that
		// dialect. Declared 3.0, `type: ['string', 'null']`, `const` and
		// `prefixItems` were all invalid there.
		openapi: '3.1.0',
		info: {
			title,
			...(summary && { summary }),
			version,
			...(description && { description }),
			...(termsOfService && { termsOfService }),
			...(contact && { contact }),
			...(license && { license }),
		},
		...(servers && servers.length > 0 && { servers }),
		paths,
	};

	const tags = documentTags(options.tags ?? [], paths);
	if (tags.length > 0) doc.tags = tags;

	// Add components if any schemas or security schemes were collected. A
	// `security` requirement naming a scheme the document does not define is
	// invalid, so the two travel together.
	const { schemas, securitySchemes } = componentCollector;
	if (
		Object.keys(schemas).length > 0 ||
		Object.keys(securitySchemes).length > 0
	) {
		doc.components = {
			...(Object.keys(schemas).length > 0 && { schemas }),
			...(Object.keys(securitySchemes).length > 0 && { securitySchemes }),
		};
	}

	return doc;
}

/**
 * The document's `tags`: the ones declared, in their order, then any an
 * operation names that were not declared — by name, in the order first met,
 * so a reference still lists every group.
 */
function documentTags(
	declared: OpenAPIV3_1.TagObject[],
	paths: OpenAPIV3_1.PathsObject,
): OpenAPIV3_1.TagObject[] {
	const tags = [...declared];
	const named = new Set(declared.map((tag) => tag.name));

	for (const item of Object.values(paths)) {
		for (const operation of Object.values(item ?? {})) {
			const operationTags = (operation as OpenAPIV3_1.OperationObject)?.tags;
			if (!Array.isArray(operationTags)) continue;
			for (const name of operationTags) {
				if (named.has(name)) continue;
				named.add(name);
				tags.push({ name });
			}
		}
	}

	return tags;
}
