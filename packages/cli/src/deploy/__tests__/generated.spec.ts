import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { initStageSecrets } from '../../secrets/storage';
import { withGeneratedSecrets } from '../generated';

const manifest = {
	AuthSecret: { kind: 'secret', id: 'AuthSecret', provides: ['AUTH_SECRET'] },
	Stripe: {
		kind: 'credential',
		id: 'Stripe',
		provides: ['STRIPE_CREDENTIALS'],
	},
} as unknown as ConstructManifest;

describe('withGeneratedSecrets', () => {
	it('generates a seed and each secret’s value for a new stage', () => {
		const { secrets, generated } = withGeneratedSecrets(
			initStageSecrets('prod'),
			manifest,
		);

		expect(generated.sort()).toEqual(['AUTH_SECRET', 'seed']);
		expect(secrets.seed).toMatch(/^[\w-]{43}$/);
		expect(secrets.custom.AUTH_SECRET).toMatch(/^[\w-]{43}$/);
		// A credential is issued by somebody else; it is never generated.
		expect(secrets.custom).not.toHaveProperty('STRIPE_CREDENTIALS');
	});

	it('is random, so no two stages share a value', () => {
		const one = withGeneratedSecrets(initStageSecrets('prod'), manifest);
		const two = withGeneratedSecrets(initStageSecrets('prod'), manifest);

		expect(one.secrets.seed).not.toBe(two.secrets.seed);
		expect(one.secrets.custom.AUTH_SECRET).not.toBe(
			two.secrets.custom.AUTH_SECRET,
		);
	});

	it('keeps what the stage already holds, set by hand or generated before', () => {
		const held = {
			...initStageSecrets('prod'),
			seed: 'existing-seed',
			custom: { AUTH_SECRET: 'set-by-hand' },
		};

		const { secrets, generated } = withGeneratedSecrets(held, manifest);

		expect(generated).toEqual([]);
		expect(secrets).toBe(held);
	});
});
