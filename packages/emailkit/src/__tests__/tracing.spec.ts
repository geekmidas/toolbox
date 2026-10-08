import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEmailClient } from '../client';

/**
 * The `email.send` span. Sent through nodemailer's JSON transport — a stub
 * that builds the message and delivers it nowhere — because the test SMTP
 * server publishes no host port the suite could rely on. Everything up to the
 * socket is the real client.
 */

const client = createEmailClient({
	smtp: { jsonTransport: true } as never,
	templates: {},
	defaults: { from: 'noreply@example.com' },
});

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

afterAll(async () => {
	await provider.shutdown();
	trace.disable();
	context.disable();
	propagation.disable();
});

it('records nothing without a provider', async () => {
	await client.send({ to: 'someone@example.com', subject: 'Hi', text: 'x' });
	expect(exporter.getFinishedSpans()).toEqual([]);
});

describe('with a provider', () => {
	beforeAll(() => provider.register());
	beforeEach(() => exporter.reset());

	it('a span per send, with its recipient count and never an address or subject', async () => {
		await client.send({
			to: ['a@example.com', 'b@example.com'],
			subject: 'Private subject',
			text: 'body',
		});

		const [span] = exporter.getFinishedSpans();
		expect(span?.name).toBe('email.send');
		expect(span?.kind).toBe(SpanKind.CLIENT);
		expect(span?.attributes).toMatchObject({
			'email.transport': 'smtp',
			'email.recipients': 2,
		});
		const recorded = JSON.stringify(span?.attributes);
		expect(recorded).not.toContain('example.com');
		expect(recorded).not.toContain('Private subject');
	});
});
