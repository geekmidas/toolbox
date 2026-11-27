import { describe, expectTypeOf, it } from 'vitest';
import type { ExtractEndpointResponse } from '../types';

/**
 * The shape the CLI generates for an endpoint that declares refusals: each
 * status beside the success, as its `application/problem+json` body.
 */
interface paths {
	'/users': {
		post: {
			requestBody: { content: { 'application/json': { email: string } } };
			responses: {
				201: { content: { 'application/json': { id: string } } };
				409: {
					content: {
						'application/problem+json': {
							type: string;
							title: string;
							status: number;
							detail: string;
							code: 'EMAIL_TAKEN';
						};
					};
				};
				422: {
					content: {
						'application/problem+json': {
							type: string;
							title: string;
							status: number;
							detail: string;
							code: 'VALIDATION_FAILED';
						};
					};
				};
			};
		};
	};
}

describe('a response with declared refusals', () => {
	it('still resolves to the success body', () => {
		expectTypeOf<
			ExtractEndpointResponse<paths, 'POST /users'>
		>().toEqualTypeOf<{
			id: string;
		}>();
	});
});
