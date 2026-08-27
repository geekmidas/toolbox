import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Credential, MalformedCredential } from '../credential';

/** An env parser that answers from a plain record. */
const parserFor = (values: Record<string, string>) =>
	({
		create(build: (get: (key: string) => any) => Record<string, unknown>) {
			const shape = build((key) => ({ string: () => ({ __key: key }) }));

			return {
				parse: () =>
					Object.fromEntries(
						Object.entries(shape).map(([field, spec]) => [
							field,
							values[(spec as { __key: string }).__key],
						]),
					),
			};
		},
	}) as never;

const schema = z.object({
	secretKey: z.string(),
	webhookSecret: z.string(),
});

const stripe = new Credential('Stripe', { schema });

const register = (
	construct: { service: { register: (o: never) => unknown } },
	values: Record<string, string>,
) => construct.service.register({ envParser: parserFor(values) } as never);

describe('Credential', () => {
	it('declares one key holding the whole credential', () => {
		expect(stripe.declare()).toEqual([
			{ kind: 'credential', id: 'Stripe', provides: ['STRIPE_CREDENTIAL'] },
		]);
	});

	it('hands a handler the parsed value, with nothing to await at the call site', async () => {
		const value = await register(new Credential('Stripe', { schema }), {
			STRIPE_CREDENTIAL: '{"secretKey":"sk_1","webhookSecret":"whsec_1"}',
		});

		expect(value).toEqual({ secretKey: 'sk_1', webhookSecret: 'whsec_1' });
	});

	it('takes a single opaque value without JSON ceremony', async () => {
		// An operator setting one by hand would get the quotes wrong once.
		const value = await register(
			new Credential('ApiKey', { schema: z.string() }),
			{ API_KEY_CREDENTIAL: 'sk_live_plain' },
		);

		expect(value).toBe('sk_live_plain');
	});

	it('keeps a JSON string a string when told to', async () => {
		const value = await register(
			new Credential('ApiKey', { schema: z.string() }),
			{ API_KEY_CREDENTIAL: 'json:"{\\"not\\":\\"parsed\\"}"' },
		);

		expect(value).toBe('{"not":"parsed"}');
	});

	it('fails where the value is read, naming what is wrong with it', async () => {
		// A half-set credential should fail when the process starts, not on the
		// first request that needs the one field somebody forgot.
		await expect(
			register(new Credential('Stripe', { schema }), {
				STRIPE_CREDENTIAL: '{"secretKey":"sk_1"}',
			}),
		).rejects.toThrow(MalformedCredential);
	});

	it('says which field, not just that something is wrong', async () => {
		await expect(
			register(new Credential('Stripe', { schema }), {
				STRIPE_CREDENTIAL: '{"secretKey":"sk_1"}',
			}),
		).rejects.toThrow(/webhookSecret/);
	});

	it('resolves once per process', async () => {
		// The alternative is a fetch on every request.
		let reads = 0;
		const counted = {
			create(build: (get: (key: string) => any) => Record<string, unknown>) {
				build(() => ({ string: () => ({}) }));
				reads++;
				return {
					parse: () => ({ raw: '{"secretKey":"a","webhookSecret":"b"}' }),
				};
			},
		} as never;

		const once = new Credential('Stripe', { schema });
		await once.service.register({ envParser: counted } as never);
		await once.service.register({ envParser: counted } as never);

		expect(reads).toBe(1);
	});

	it('re-resolves when asked to', async () => {
		let reads = 0;
		const counted = {
			create(build: (get: (key: string) => any) => Record<string, unknown>) {
				build(() => ({ string: () => ({}) }));
				reads++;
				return {
					parse: () => ({ raw: '{"secretKey":"a","webhookSecret":"b"}' }),
				};
			},
		} as never;

		const fresh = new Credential('Stripe', { schema, refresh: true });
		await fresh.service.register({ envParser: counted } as never);
		await fresh.service.register({ envParser: counted } as never);

		expect(reads).toBe(2);
	});
});
