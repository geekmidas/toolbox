import { parseKeyring } from '@geekmidas/constructs/encryption';
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
	Pii: { kind: 'encryption', id: 'Pii', provides: ['PII_URL'] },
} as unknown as ConstructManifest;

describe('withGeneratedSecrets', () => {
	it('generates a seed and each secret’s value for a new stage', () => {
		const { secrets, generated } = withGeneratedSecrets(
			initStageSecrets('prod'),
			manifest,
		);

		expect(generated.sort()).toEqual(['AUTH_SECRET', 'PII_URL', 'seed']);
		// One random key to start with; later keys come from a rotate.
		expect(
			parseKeyring('Pii', secrets.custom.PII_URL!).keys.map(({ id }) => id),
		).toEqual(['k1']);
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
			// A rotated keyring included: a redeploy must never replace it, or
			// everything its older keys wrote stops opening.
			custom: { AUTH_SECRET: 'set-by-hand', PII_URL: 'a-rotated-keyring' },
		};

		const { secrets, generated } = withGeneratedSecrets(held, manifest);

		expect(generated).toEqual([]);
		expect(secrets).toBe(held);
	});
});
