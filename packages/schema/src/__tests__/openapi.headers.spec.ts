import { describe, expect, it } from 'vitest';
import { buildOpenApiSchema, type ComponentCollector } from '../openapi';

describe('shared headers', () => {
	it('are emitted once under components.parameters and components.headers', async () => {
		const endpoint = {
			async toOpenApi3Route(collector?: ComponentCollector) {
				collector?.addParameter?.('Idempotency-Key', {
					name: 'Idempotency-Key',
					in: 'header',
					required: true,
					schema: { type: 'string' },
				});
				collector?.addHeader?.('ETag', { schema: { type: 'string' } });
				return {
					'/payments': {
						post: {
							parameters: [{ $ref: '#/components/parameters/Idempotency-Key' }],
							responses: {
								'201': {
									description: 'Created',
									headers: { ETag: { $ref: '#/components/headers/ETag' } },
								},
							},
						},
					},
				};
			},
		};

		const doc = await buildOpenApiSchema([endpoint, endpoint]);

		expect(doc.components).toEqual({
			parameters: {
				'Idempotency-Key': {
					name: 'Idempotency-Key',
					in: 'header',
					required: true,
					schema: { type: 'string' },
				},
			},
			headers: { ETag: { schema: { type: 'string' } } },
		});
	});

	it('leave components out when there are none', async () => {
		const doc = await buildOpenApiSchema([
			{ toOpenApi3Route: async () => ({ '/plain': { get: {} } }) },
		]);

		expect(doc.components).toBeUndefined();
	});
});
