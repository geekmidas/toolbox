import { Hono } from 'hono';
import { describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { ExternalApi, fake } from '../../external-api';
import { Topic } from '../../topic/Topic';
import {
	type ClientOf,
	featureTest,
	type TestServices,
	UnknownService,
} from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * `services.get(name)`: what a handler depending on a construct is handed,
 * resolved the way the test's endpoints resolve it. An external API's client is
 * aimed at whatever the test stage resolved — its fake, which the test never
 * sees — so a test asserts through the API's own contract.
 */

const carrier = new ExternalApi('Carrier', {
	url: 'https://api.carrier.example',
	credentials: z.object({ key: z.string() }),
	client: ({ url, credentials }) => {
		const headers = { authorization: `Bearer ${credentials.key}` };
		return {
			async quote(to: string) {
				await fetch(`${url}/quotes`, {
					method: 'POST',
					headers: { ...headers, 'content-type': 'application/json' },
					body: JSON.stringify({ to }),
				});
			},
			async quotes(to: string): Promise<string[]> {
				const response = await fetch(`${url}/quotes?to=${to}`, { headers });
				return (await response.json()) as string[];
			},
		};
	},
});

// The carrier's fake: a more complete carrier, sharing nothing with the test.
const asked: string[] = [];
const carrierFake = fake.app(
	new Hono()
		.post('/quotes', async (c) => {
			asked.push((await c.req.json<{ to: string }>()).to);
			return c.json({});
		})
		.get('/quotes', (c) =>
			c.json(asked.filter((to) => to === c.req.query('to'))),
		),
	{ credentials: { key: 'fake' } },
);

const users = new Topic('Users', {
	events: { 'user.created': z.object({ id: z.string() }) },
});

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Carrier: {
			kind: 'external-api',
			source: { file: 'constructs', export: 'carrier' },
		},
		Users: { kind: 'topic', source: { file: 'constructs', export: 'users' } },
	},
	endpoints: [],
	env: {
		CARRIER_URL: 'http://carrier.fake.test',
		CARRIER_CREDENTIALS: JSON.stringify({ key: 'fake' }),
	},
};

type Services = {
	carrier: ClientOf<typeof carrier>;
	users: ClientOf<typeof users>;
};

const it = featureTest<
	import('@geekmidas/testkit/browser').Browser,
	{},
	{},
	Services
>({
	manifest,
	modules: { constructs: { carrier, users } },
	fakes: { Carrier: carrierFake },
});

describe('services', () => {
	it('hands the client a handler gets, aimed at what the stage resolved', async ({
		services,
	}) => {
		const shipping = await services.get('carrier');

		await shipping.quote('Cape Town');

		// Asked through the carrier's own read endpoint — the same assertion
		// would hold against the real carrier's sandbox.
		expect(await shipping.quotes('Cape Town')).toEqual(['Cape Town']);
	});

	it('hands a topic as its recorder, so publishing is recorded', async ({
		services,
		published,
	}) => {
		const topic = await services.get('users');

		await topic.publish([{ type: 'user.created', payload: { id: 'u-1' } }]);

		expect(published(users)).toEqual([
			{ type: 'user.created', payload: { id: 'u-1' } },
		]);
	});

	it('names a service the app does not declare', async ({ services }) => {
		await expect(
			(services as TestServices<Record<string, unknown>>).get('nope'),
		).rejects.toBeInstanceOf(UnknownService);
	});
});
