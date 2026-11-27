import { RestApi } from '@geekmidas/constructs/rest-api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

/**
 * What the generated `paths` says about each operation, for endpoints built
 * the way an app builds them.
 */
const api = new RestApi('Ops', { path: '.', defaultAuthorizer: 'none' });

const generate = (endpoints: unknown[]) =>
	new OpenApiTsGenerator().generate(endpoints as never);

/** The `paths` entry for one route, as text. */
function pathEntry(content: string, route: string): string {
	const start = content.indexOf(`'${route}': {`);
	const end = content.indexOf('\n  };', start);
	return content.slice(start, end);
}

describe('OpenApiTsGenerator — operations', () => {
	it('makes an optional request body an optional key', async () => {
		const touch = api
			.post('/touch')
			.body(z.object({ note: z.string() }).optional())
			.handle(async () => ({}));
		const create = api
			.post('/things')
			.body(z.object({ name: z.string() }))
			.handle(async () => ({}));

		const content = await generate([touch, create]);

		expect(pathEntry(content, '/touch')).toContain('requestBody?: {');
		expect(pathEntry(content, '/things')).toContain('requestBody: {');
	});
});
