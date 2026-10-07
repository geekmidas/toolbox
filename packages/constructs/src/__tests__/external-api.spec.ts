import { EnvironmentParser } from '@geekmidas/envkit';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MalformedCredential } from '../credential';
import { ExternalApi, fake, isFake } from '../external-api';

const credentials = z.object({
	clientId: z.string(),
	clientSecret: z.string(),
});

const fakePolar = new Hono().get('/v3/users/:id', (c) =>
	c.json({ id: c.req.param('id') }),
);

const polar = () =>
	new ExternalApi('Polar', {
		url: 'https://www.polaraccesslink.com',
		credentials,
		client: ({ url, credentials }) => ({ url, clientId: credentials.clientId }),
	});

const register = <T>(
	construct: { service: { register: (o: never) => T } },
	env: Record<string, string>,
) =>
	construct.service.register({
		envParser: new EnvironmentParser(env),
	} as never);

describe('ExternalApi', () => {
	it('declares its address and its credentials, and nothing about a fake', () => {
		expect(polar().declare()).toEqual([
			{
				kind: 'external-api',
				id: 'Polar',
				url: 'https://www.polaraccesslink.com',
				provides: ['POLAR_URL', 'POLAR_CREDENTIALS'],
			},
		]);
	});

	it('exposes its credentials schema, so a value can be checked before it is stored', async () => {
		const api = polar();
		expect(api.credentialsSchema).toBe(credentials);

		const checked = await api.credentialsSchema['~standard'].validate({
			clientId: 'id',
		});
		expect(checked.issues?.map((issue) => issue.path)).toEqual([
			['clientSecret'],
		]);
	});

	it('declares a URL per stage as written', () => {
		const payfast = new ExternalApi('PayFast', {
			url: {
				prod: 'https://www.payfast.co.za',
				default: 'https://sandbox.payfast.co.za',
			},
			credentials: z.object({ merchantId: z.string() }),
			client: () => ({}),
		});

		expect(payfast.declare()[0]).toMatchObject({
			url: {
				prod: 'https://www.payfast.co.za',
				default: 'https://sandbox.payfast.co.za',
			},
		});
	});

	it('hands a handler the client, built from the address and credentials it was given', async () => {
		const client = await register(polar(), {
			POLAR_URL: 'http://localhost:4010',
			POLAR_CREDENTIALS: '{"clientId":"id_1","clientSecret":"secret_1"}',
		});

		expect(client).toEqual({ url: 'http://localhost:4010', clientId: 'id_1' });
	});

	it('builds the client once, however many times it is registered', async () => {
		const api = polar();
		const env = {
			POLAR_URL: 'http://localhost:4010',
			POLAR_CREDENTIALS: '{"clientId":"id_1","clientSecret":"secret_1"}',
		};

		expect(await register(api, env)).toBe(await register(api, env));
	});

	it('refuses credentials that are not what the schema says', async () => {
		await expect(
			register(polar(), {
				POLAR_URL: 'http://localhost:4010',
				POLAR_CREDENTIALS: '{"clientId":"id_1"}',
			}),
		).rejects.toBeInstanceOf(MalformedCredential);
	});
});

describe('fake', () => {
	it('builds an app fake that answers requests', async () => {
		const polarFake = fake.app<ReturnType<typeof polar>>(fakePolar, {
			credentials: { clientId: 'fake', clientSecret: 'fake' },
		});

		expect(isFake(polarFake)).toBe(true);
		if (polarFake.kind !== 'app') return expect.unreachable('an app fake');

		const response = await polarFake.handler.fetch(
			new Request('http://polar.test/v3/users/42'),
		);
		expect(await response.json()).toEqual({ id: '42' });
	});

	it('builds an image fake from the image and the port it listens on', () => {
		expect(
			fake.image('stripe/stripe-mock', {
				port: 12111,
				credentials: { secretKey: 'sk_test_fake' },
			}),
		).toMatchObject({
			kind: 'image',
			image: 'stripe/stripe-mock',
			port: 12111,
			credentials: { secretKey: 'sk_test_fake' },
		});
	});

	it('tells a fake from anything else a module might export', () => {
		expect(isFake(fakePolar)).toBe(false);
		expect(isFake({ kind: 'app', handler: fakePolar })).toBe(false);
		expect(isFake(undefined)).toBe(false);
	});
});
