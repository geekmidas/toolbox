import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { EndpointFactory } from '../EndpointFactory';

const ServiceA = {
	serviceName: 'a' as const,
	async register() {
		return { test: () => 'a' };
	},
} satisfies Service<'a', any>;

const ServiceB = {
	serviceName: 'b' as const,
	async register() {
		return { test: () => 'b' };
	},
} satisfies Service<'b', any>;

describe('EndpointFactory - Reference Sharing Audit', () => {
	describe('services array', () => {
		it('should not share services array references between builders', () => {
			const factory = new EndpointFactory().services([ServiceA, ServiceB]);

			const builder1 = factory.post('/a');
			const builder2 = factory.post('/b');

			// Should not be the same reference
			expect((builder1 as any)._services === (builder2 as any)._services).toBe(
				false,
			);

			// But should have same content
			expect((builder1 as any)._services).toEqual([ServiceA, ServiceB]);
			expect((builder2 as any)._services).toEqual([ServiceA, ServiceB]);
		});

		it('should not mutate factory services when builder adds services', () => {
			const factory = new EndpointFactory().services([ServiceA]);

			const builder = factory.post('/test');
			const originalServices = (factory as any).defaultServices;

			// Builder adds more services
			builder.services([ServiceB]);

			// Factory's defaultServices should be unchanged
			expect((factory as any).defaultServices).toEqual(originalServices);
			expect((factory as any).defaultServices.length).toBe(1);
		});
	});

	describe('events array', () => {
		it('should not share events array references between builders', () => {
			const factory = new EndpointFactory();

			const builder1 = factory.post('/a');
			const builder2 = factory.post('/b');

			// Each builder should have its own events array
			expect((builder1 as any)._events === (builder2 as any)._events).toBe(
				false,
			);
			expect((builder1 as any)._events).toEqual([]);
			expect((builder2 as any)._events).toEqual([]);
		});

		it('should not share events between builders even after adding events', () => {
			const factory = new EndpointFactory();

			const builder1 = factory.post('/a');
			const builder2 = factory.post('/b');

			// Add event to builder1
			const mockEvent: any = { type: 'test', map: () => ({}) };
			(builder1 as any)._events.push(mockEvent);

			// builder2 should not have the event
			expect((builder1 as any)._events.length).toBe(1);
			expect((builder2 as any)._events.length).toBe(0);
		});
	});

	describe('schemas object', () => {
		it('should not share schemas object references between builders', () => {
			const factory = new EndpointFactory();

			const builder1 = factory.post('/a');
			const builder2 = factory.post('/b');

			// Each builder should have its own schemas object
			expect((builder1 as any).schemas === (builder2 as any).schemas).toBe(
				false,
			);
		});

		it('should not share schemas between builders after setting schemas', () => {
			const factory = new EndpointFactory();
			const bodySchema: any = { '~standard': { validate: () => ({}) } };

			const builder1 = factory.post('/a').body(bodySchema);
			const builder2 = factory.post('/b');

			// builder1 should have body schema, builder2 should not
			expect((builder1 as any).schemas.body).toBeDefined();
			expect((builder2 as any).schemas.body).toBeUndefined();
		});
	});

	describe('logger (intentionally shared)', () => {
		it('should share logger references between builders (by design)', () => {
			const logger = new ConsoleLogger({ app: 'test' });
			const factory = new EndpointFactory().logger(logger);

			const builder1 = factory.post('/a');
			const builder2 = factory.post('/b');

			// Logger should be the same reference (it's a singleton service)
			expect((builder1 as any)._logger === (builder2 as any)._logger).toBe(
				true,
			);
			expect((builder1 as any)._logger).toBe(logger);
		});
	});

	describe('authorize and session functions', () => {
		it('should share authorize function reference (by design)', () => {
			const authFn = async () => true;
			const factory = new EndpointFactory().authorize(authFn);

			const builder1 = factory.post('/a');
			const builder2 = factory.post('/b');

			// Function should be the same reference
			expect(
				(builder1 as any)._authorize === (builder2 as any)._authorize,
			).toBe(true);
			expect((builder1 as any)._authorize).toBe(authFn);
		});

		it('should share session extractor function reference (by design)', () => {
			const sessionFn = async () => ({ userId: '123' });
			const factory = new EndpointFactory().session(sessionFn);

			const builder1 = factory.post('/a');
			const builder2 = factory.post('/b');

			// Function should be the same reference
			expect(
				(builder1 as any)._getSession === (builder2 as any)._getSession,
			).toBe(true);
			expect((builder1 as any)._getSession).toBe(sessionFn);
		});
	});

	describe('complex nested factory chains', () => {
		it('should maintain proper isolation through multiple factory layers', () => {
			// Create base router
			const base = new EndpointFactory().services([ServiceA]);

			// Create auth router from base
			const authRouter = base.authorize(async () => true);

			// Create API v1 router from auth router
			const v1Router = authRouter.route('/v1').services([ServiceB]);

			// Create endpoints from different routers
			const ep1 = base.get('/test').handle(() => ({}));
			const ep2 = authRouter.get('/test').handle(() => ({}));
			const ep3 = v1Router.get('/test').handle(() => ({}));

			// Verify service isolation
			expect(ep1.services.map((s) => s.serviceName)).toEqual(['a']);
			expect(ep2.services.map((s) => s.serviceName)).toEqual(['a']);
			expect(ep3.services.map((s) => s.serviceName)).toEqual(['b', 'a']);

			// Verify they don't share internal arrays
			const builder1 = base.get('/x');
			const builder2 = authRouter.get('/x');
			const builder3 = v1Router.get('/x');

			expect((builder1 as any)._services === (builder2 as any)._services).toBe(
				false,
			);
			expect((builder2 as any)._services === (builder3 as any)._services).toBe(
				false,
			);
		});
	});
});
