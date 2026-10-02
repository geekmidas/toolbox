import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { composeFor } from '../compose';
import { portKeys } from '../containers';
import { envFor } from '../env';
import { NoFake, NotAFake, readFakes } from '../fakes';
import { planFor } from '../plan';
import { derivedContainers, fakesApply } from '../workspace';

const manifest = {
	Polar: {
		kind: 'external-api',
		id: 'Polar',
		url: 'https://www.polaraccesslink.com',
		provides: ['POLAR_URL', 'POLAR_CREDENTIALS'],
	},
	Stripe: {
		kind: 'external-api',
		id: 'Stripe',
		url: 'https://api.stripe.com',
		provides: ['STRIPE_URL', 'STRIPE_CREDENTIALS'],
	},
} satisfies ConstructManifest;

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const fakes = await readFakes(join(fixtures, 'fakes'), manifest);

const plan = planFor(manifest, 'dev', provisionOrder(manifest), {
	localStage: 'dev',
	fakes,
});

describe('readFakes', () => {
	it('reads each fake from test/fakes/<id>.ts, by what it was built as', () => {
		expect(fakes).toEqual({
			Polar: {
				file: join(fixtures, 'fakes/test/fakes/polar.ts'),
				credentials: '{"clientId":"fake","clientSecret":"fake"}',
			},
			Stripe: {
				file: join(fixtures, 'fakes/test/fakes/stripe.ts'),
				image: 'stripe/stripe-mock',
				port: 12111,
				credentials: '{"secretKey":"sk_test_fake"}',
			},
		});
	});

	it('refuses an external API with no fake, naming the file to create', async () => {
		await expect(
			readFakes(join(fixtures, 'fakes-broken'), { Stripe: manifest.Stripe }),
		).rejects.toThrow(NoFake);
		await expect(
			readFakes(join(fixtures, 'fakes-broken'), { Stripe: manifest.Stripe }),
		).rejects.toThrow(expect.objectContaining({ id: 'Stripe' }));
	});

	it('refuses a default export that is not a fake', async () => {
		await expect(
			readFakes(join(fixtures, 'fakes-broken'), { Polar: manifest.Polar }),
		).rejects.toThrow(NotAFake);
	});
});

describe('an external API, locally', () => {
	it('runs an image fake as a container of its own, and a module fake in none', () => {
		expect(plan.containers).toEqual(['stripe-fake']);
		expect(plan.fakes).toEqual({
			'polar-fake': { id: 'Polar' },
			'stripe-fake': {
				id: 'Stripe',
				image: 'stripe/stripe-mock',
				port: 12111,
			},
		});
	});

	it('allocates a port for every fake, served by gkm or by a container', () => {
		expect(portKeys(plan.containers, plan.fakes)).toEqual([
			'stripe-fake',
			'polar-fake',
		]);
	});

	it('points each API at its fake, with the credentials the fake accepts', () => {
		const env = envFor(plan, {
			ports: { 'polar-fake': 4010, 'stripe-fake': 4011 },
		});

		expect(env).toMatchObject({
			POLAR_URL: 'http://localhost:4010',
			POLAR_CREDENTIALS: '{"clientId":"fake","clientSecret":"fake"}',
			STRIPE_URL: 'http://localhost:4011',
			STRIPE_CREDENTIALS: '{"secretKey":"sk_test_fake"}',
		});
	});

	it('never resolves the provider, whatever the declaration says', () => {
		const env = envFor(plan, {
			ports: { 'polar-fake': 4010, 'stripe-fake': 4011 },
		});

		expect(Object.values(env).join(' ')).not.toMatch(
			/polaraccesslink|api\.stripe\.com/,
		);
	});

	it("publishes an image fake on its assigned port, the provider's image as it ships", () => {
		const compose = composeFor(plan, {
			project: 'shop',
			ports: { 'polar-fake': 4010, 'stripe-fake': 4011 },
		});

		expect(compose.services['stripe-fake']).toEqual({
			image: 'stripe/stripe-mock',
			restart: 'unless-stopped',
			ports: ['4011:12111'],
		});
		expect(compose.services['polar-fake']).toBeUndefined();
	});
});

describe('an external API, unfaked', () => {
	const real = planFor(manifest, 'production', provisionOrder(manifest), {
		localStage: 'development',
	});

	it('is the provider, at its URL for the stage, with no fake running', () => {
		expect(real.containers).not.toContain('stripe-fake');
		expect(real.fakes).toBeUndefined();
		expect(envFor(real, { ports: {} })).toMatchObject({
			POLAR_URL: 'https://www.polaraccesslink.com',
			STRIPE_URL: 'https://api.stripe.com',
		});
	});

	it('leaves its credentials to the stage’s own secrets', () => {
		expect(envFor(real, { ports: {} })).not.toHaveProperty('POLAR_CREDENTIALS');
	});
});

describe('fakesApply', () => {
	it('fakes for gkm test, always', () => {
		expect(fakesApply('test', undefined, {})).toBe(true);
	});

	it('fakes for gkm dev only when asked, by the flag or the workspace', () => {
		expect(fakesApply('development', undefined, {})).toBe(false);
		expect(fakesApply('development', true, {})).toBe(true);
		expect(fakesApply('development', undefined, { GKM_FAKE: '1' })).toBe(true);
	});
});

describe('derivedContainers', () => {
	const workspace = (root: string) =>
		({
			stages: { local: 'development', deployed: ['production'] },
			name: 'shop',
			root,
			apps: {},
			deploy: { default: 'dokploy' },
			shared: { packages: [] },
			secrets: {},
		}) as NormalizedWorkspace;

	it('never reads a fake — setup, secrets:* and docker run none', async () => {
		for (const stage of ['development', 'production']) {
			const containers = await derivedContainers(
				workspace(join(fixtures, 'fakes-broken')),
				stage,
				manifest,
			);
			expect(containers).not.toContain('stripe-fake');
		}
	});
});
