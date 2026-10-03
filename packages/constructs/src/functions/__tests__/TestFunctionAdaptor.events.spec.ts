import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { recordingPublisher } from '../../__tests__/__helpers__/recordingPublisher';
import { Topic } from '../../topic/Topic';
import { FunctionBuilder } from '../FunctionBuilder';
import { TestFunctionAdaptor } from '../TestFunctionAdaptor';

const orders = new Topic('Orders', {
	events: { 'order.placed': z.object({ orderId: z.string() }) },
});
const audit = new Topic('Audit', {
	events: { 'audit.logged': z.object({ what: z.string() }) },
});

describe('TestFunctionAdaptor — events', () => {
	it('publishes each event to the recorder the test handed in for its topic', async () => {
		const fn = new FunctionBuilder()
			.input(z.object({ orderId: z.string() }))
			.output(z.object({ orderId: z.string() }))
			.event(orders, {
				type: 'order.placed',
				payload: (output) => ({ orderId: output.orderId }),
			})
			.event(audit, {
				type: 'audit.logged',
				payload: () => ({ what: 'order' }),
			})
			.handle(async ({ input }) => ({ orderId: input.orderId }));

		const ordersRecorder = recordingPublisher();
		const auditRecorder = recordingPublisher();

		// No ORDERS_/AUDIT_PUBLISHER_CONNECTION_STRING: the recorders must be
		// used as given, never the topics' real services.
		await new TestFunctionAdaptor(fn).invoke({
			input: { orderId: 'o-1' },
			services: { orders: ordersRecorder, audit: auditRecorder },
		} as never);

		expect(ordersRecorder.published).toEqual([
			{ type: 'order.placed', payload: { orderId: 'o-1' } },
		]);
		expect(auditRecorder.published).toEqual([
			{ type: 'audit.logged', payload: { what: 'order' } },
		]);
	});
});
