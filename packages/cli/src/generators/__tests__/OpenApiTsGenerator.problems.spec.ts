import { RestApi } from '@geekmidas/constructs/rest-api';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

const problems = new RestApi('Problems', {
	path: '.',
	defaultAuthorizer: 'none',
	errors: 'problem',
});
const legacy = new RestApi('Legacy', { path: '.', defaultAuthorizer: 'none' });

function createUser(api: RestApi<string>) {
	return api
		.post('/users')
		.body(z.object({ email: z.email() }))
		.output(z.object({ id: z.string() }))
		.error(409, 'EMAIL_TAKEN', { details: z.object({ email: z.string() }) })
		.error(409, 'HANDLE_TAKEN')
		.handle(async () => ({ id: '1' }));
}

describe('OpenApiTsGenerator — refusals', () => {
	it('types each declared status as its application/problem+json body', async () => {
		const content = await new OpenApiTsGenerator().generate([
			createUser(problems) as any,
		]);

		expect(content).toContain('200: {');
		expect(content).toContain(
			"409: {\n          content: {\n            'application/problem+json': { type: string; title: string; status: number; detail: string; instance?: string; code: 'EMAIL_TAKEN' | 'HANDLE_TAKEN'; details?: { email: string } };",
		);
		// The 422 its body schema answers with.
		expect(content).toContain(
			"code: 'VALIDATION_FAILED'; details?: Array<{ message: string; path?: Array<unknown> }>",
		);
	});

	it('lists the statuses, with no body, for a surface answering the default body', async () => {
		const content = await new OpenApiTsGenerator().generate([
			createUser(legacy) as any,
		]);

		expect(content).toContain('409: {\n          content?: never;\n        };');
		expect(content).not.toContain('application/problem+json');
		expect(content).not.toContain('422:');
	});

	it('leaves an endpoint that declares none as it was', async () => {
		const health = problems.get('/health').handle(async () => ({}));
		const content = await new OpenApiTsGenerator().generate([health as any]);

		expect(content).not.toContain('application/problem+json');
	});
});
