import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { e } from '../EndpointFactory';

describe('Endpoint type inference', () => {
	it('should not include body/params/query when not defined', () => {
		const endpoint = e.get('/test').handle((ctx) => {
			expectTypeOf(ctx).toHaveProperty('services');
			expectTypeOf(ctx).toHaveProperty('logger');
			expectTypeOf(ctx).toHaveProperty('header');
			expectTypeOf(ctx).toHaveProperty('session');

			// These should NOT exist
			expectTypeOf(ctx).not.toHaveProperty('body');
			expectTypeOf(ctx).not.toHaveProperty('params');
			expectTypeOf(ctx).not.toHaveProperty('query');

			return { success: true };
		});
	});

	it('should include body when defined', () => {
		const endpoint = e
			.post('/test')
			.body(z.object({ name: z.string() }))
			.handle((ctx) => {
				expectTypeOf(ctx).toHaveProperty('body');
				expectTypeOf(ctx.body).toEqualTypeOf<{ name: string }>();

				// These should NOT exist
				expectTypeOf(ctx).not.toHaveProperty('params');
				expectTypeOf(ctx).not.toHaveProperty('query');

				return { success: true };
			});
	});

	it('should include params when defined', () => {
		const endpoint = e
			.get('/test/:id')
			.params(z.object({ id: z.string() }))
			.handle((ctx) => {
				expectTypeOf(ctx).toHaveProperty('params');
				expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();

				// These should NOT exist
				expectTypeOf(ctx).not.toHaveProperty('body');
				expectTypeOf(ctx).not.toHaveProperty('query');

				return { success: true };
			});
	});

	it('should include query when defined', () => {
		const endpoint = e
			.get('/test')
			.query(z.object({ filter: z.string() }))
			.handle((ctx) => {
				expectTypeOf(ctx).toHaveProperty('query');
				expectTypeOf(ctx.query).toEqualTypeOf<{ filter: string }>();

				// These should NOT exist
				expectTypeOf(ctx).not.toHaveProperty('body');
				expectTypeOf(ctx).not.toHaveProperty('params');

				return { success: true };
			});
	});

	it('should include all properties when all are defined', () => {
		const endpoint = e
			.post('/test/:id')
			.body(z.object({ name: z.string() }))
			.params(z.object({ id: z.string() }))
			.query(z.object({ filter: z.string() }))
			.handle((ctx) => {
				expectTypeOf(ctx).toHaveProperty('body');
				expectTypeOf(ctx).toHaveProperty('params');
				expectTypeOf(ctx).toHaveProperty('query');

				expectTypeOf(ctx.body).toEqualTypeOf<{ name: string }>();
				expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
				expectTypeOf(ctx.query).toEqualTypeOf<{ filter: string }>();

				return { success: true };
			});
	});
});
