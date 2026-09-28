import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
	SnifferEnvironmentParser,
	sniffWithFireAndForget,
} from '../SnifferEnvironmentParser';

describe('SnifferEnvironmentParser mock values', () => {
	it('mocks a whole object when a sniffed schema is parsed directly', () => {
		const sniffer = new SnifferEnvironmentParser();
		let parsed: unknown;

		sniffer.create((get) => {
			parsed = get('DB')
				.object({
					host: z.string(),
					port: z.number(),
					debug: z.boolean(),
					tags: z.array(z.string()),
					mode: z.enum(['a', 'b']),
					note: 'not a schema' as never,
				})
				.parse({});
			return {};
		});

		expect(parsed).toEqual({
			host: '',
			port: 0,
			debug: false,
			tags: [],
			mode: '',
		});
	});

	it('mocks an unrecognised schema type as an empty string', () => {
		const sniffer = new SnifferEnvironmentParser();
		let parsed: unknown;

		sniffer.create((get) => {
			parsed = get('MODE').enum(['dev', 'prod']).parse('x');
			return {};
		});

		expect(parsed).toBe('');
	});

	it('passes through what a schema method returns when it is not a schema', () => {
		const sniffer = new SnifferEnvironmentParser();
		let optional: unknown;
		let description: unknown;

		sniffer.create((get) => {
			const schema = get('PORT').string().describe('the port');
			optional = schema.isOptional();
			description = schema.description;
			return {};
		});

		expect(optional).toBe(false);
		expect(description).toBe('the port');
	});

	it('falls back per type for schemas that did not come from get()', () => {
		const sniffer = new SnifferEnvironmentParser();

		const config = sniffer
			.create(() => ({
				name: z.string(),
				port: z.number(),
				debug: z.boolean(),
				hosts: z.array(z.string()),
				maybe: z.string().optional(),
				nothing: z.string().nullable(),
				db: z.object({ host: z.string(), retries: z.number() }),
				mode: z.literal('x'),
				nested: { inner: z.number(), label: 'plain' as never },
			}))
			.parse();

		expect(config).toEqual({
			name: '',
			port: 0,
			debug: false,
			hosts: [],
			maybe: undefined,
			nothing: null,
			db: { host: '', retries: 0 },
			mode: '',
			nested: { inner: 0 },
		});
		expect(sniffer.getEnvironmentVariables()).toEqual([]);
	});
});

describe('sniffWithFireAndForget', () => {
	it('wraps a thrown non-Error', async () => {
		const result = await sniffWithFireAndForget(
			new SnifferEnvironmentParser(),
			() => {
				throw 'bad config';
			},
			{ settleTimeMs: 0 },
		);

		expect(result.error).toBeInstanceOf(Error);
		expect(result.error?.message).toBe('bad config');
	});

	it('wraps a non-Error rejection', async () => {
		const result = await sniffWithFireAndForget(
			new SnifferEnvironmentParser(),
			() => Promise.reject(42),
			{ settleTimeMs: 0 },
		);

		expect(result.error?.message).toBe('42');
	});

	it('collects fire-and-forget rejections, Error or not', async () => {
		const result = await sniffWithFireAndForget(
			new SnifferEnvironmentParser(),
			() => {
				// Deliberately unawaited, as a library's background work would be.
				Promise.reject(new Error('late'));
				Promise.reject('later');
			},
			{ settleTimeMs: 20 },
		);

		expect(result.error).toBeUndefined();
		expect(result.unhandledRejections.map((e) => e.message).sort()).toEqual([
			'late',
			'later',
		]);
	});

	it('uses the default settle time when none is given', async () => {
		const sniffer = new SnifferEnvironmentParser();

		const result = await sniffWithFireAndForget(sniffer, () => {
			sniffer.create((get) => ({ url: get('URL').string() }));
		});

		expect(result.envVars).toEqual(['URL']);
	});
});
