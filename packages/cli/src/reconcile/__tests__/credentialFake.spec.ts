import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { workspaceStageKeys } from '../../secrets/stageKeys';
import { envFor } from '../env';
import {
	assertTestCredentials,
	CredentialHasNoTestValue,
	NotAFake,
	readCredentialFakes,
	readFakes,
} from '../fakes';
import { planFor } from '../plan';
import { TEST_CREDENTIALS } from './__helpers__/credentials';

/**
 * A `Credential` on a stage that fakes — `gkm test`, `gkm dev --fake` — is
 * handed its fake from `test/fakes/<id>.ts`, the folder an external API's
 * fake lives in. Nothing acting on a deployed stage reads it.
 */

const manifest = {
	ReviewerPassword: {
		kind: 'credential',
		id: 'ReviewerPassword',
		provides: ['REVIEWER_PASSWORD_CREDENTIALS'],
	},
	Payments: {
		kind: 'credential',
		id: 'Payments',
		provides: ['PAYMENTS_CREDENTIALS'],
	},
	Webhooks: {
		kind: 'credential',
		id: 'Webhooks',
		provides: ['WEBHOOKS_CREDENTIALS'],
	},
} satisfies ConstructManifest;

const fixtures = join(import.meta.dirname, '__fixtures__');
const root = join(fixtures, 'fakes');

const credentialFakes = await readCredentialFakes(root, manifest);

const plan = (stage: string, faked: boolean) =>
	planFor(manifest, stage, provisionOrder(manifest), {
		localStage: 'development',
		...(faked ? { credentialFakes } : {}),
	});

describe('readCredentialFakes', () => {
	it('reads each credential’s fake as the JSON its key holds, and skips one with none', () => {
		expect(credentialFakes).toEqual({
			ReviewerPassword: '"a-reviewer-password-for-tests"',
			Payments: '{"secretKey":"sk_test_fake"}',
		});
	});

	it('is not read as an external API’s fake', async () => {
		expect(await readFakes(root, manifest)).toEqual({});
	});

	it('refuses an external API’s fake where a credential’s belongs', async () => {
		await expect(
			readCredentialFakes(join(fixtures, 'fakes-broken'), {
				StripeKeys: {
					kind: 'credential',
					id: 'StripeKeys',
					provides: ['STRIPE_KEYS_CREDENTIALS'],
				},
			}),
		).rejects.toThrow(NotAFake);
	});

	it('refuses a credential’s fake where an external API’s belongs', async () => {
		await expect(
			readFakes(join(fixtures, 'fakes-broken'), {
				Carrier: {
					kind: 'external-api',
					id: 'Carrier',
					url: 'https://api.carrier.example',
					provides: ['CARRIER_URL', 'CARRIER_CREDENTIALS'],
				},
			}),
		).rejects.toThrow(NotAFake);
	});
});

describe('a credential, on a stage that fakes', () => {
	const env = envFor(plan('test', true), {
		ports: {},
		credentials: TEST_CREDENTIALS,
	});

	it('is handed its fake’s value', () => {
		expect(env).toMatchObject({
			REVIEWER_PASSWORD_CREDENTIALS: '"a-reviewer-password-for-tests"',
			PAYMENTS_CREDENTIALS: '{"secretKey":"sk_test_fake"}',
		});
	});

	it('is left to the stage without one', () => {
		expect(env).not.toHaveProperty('WEBHOOKS_CREDENTIALS');
	});
});

describe('assertTestCredentials', () => {
	const faked = plan('test', true);

	it('answers every credential’s value: a fake’s, or one the stage stores', () => {
		const env = {
			...envFor(faked, { ports: {}, credentials: TEST_CREDENTIALS }),
			WEBHOOKS_CREDENTIALS: 'whsec_stored',
		};

		expect(assertTestCredentials(root, faked, env)).toEqual({
			REVIEWER_PASSWORD_CREDENTIALS: '"a-reviewer-password-for-tests"',
			PAYMENTS_CREDENTIALS: '{"secretKey":"sk_test_fake"}',
			WEBHOOKS_CREDENTIALS: 'whsec_stored',
		});
	});

	it('refuses one with neither, naming its key and the fake to add', () => {
		const env = envFor(faked, { ports: {}, credentials: TEST_CREDENTIALS });
		const run = () => assertTestCredentials(root, faked, env);

		expect(run).toThrow(CredentialHasNoTestValue);
		expect(run).toThrow(
			expect.objectContaining({
				id: 'Webhooks',
				key: 'WEBHOOKS_CREDENTIALS',
				file: join(root, 'test/fakes/webhooks.ts'),
			}),
		);
		expect(run).toThrow(/fake\.credential\(…\)/);
	});
});

describe('a credential, on a deployed stage', () => {
	it('is never its fake: the plan is made without one', () => {
		expect(
			envFor(plan('production', false), {
				ports: {},
				credentials: TEST_CREDENTIALS,
			}),
		).not.toHaveProperty('PAYMENTS_CREDENTIALS');
	});

	it('is still a key the stage must set, fake or not', () => {
		const keys = workspaceStageKeys({
			manifest: {
				...manifest,
				Api: {
					kind: 'rest-api',
					id: 'Api',
					endpoints: [],
					provides: ['API_URL'],
				},
			} as ConstructManifest,
			// An endpoint on the API depends on the credential.
			runnables: { Api: ['Payments'] },
			local: false,
			supplied: {},
		});

		expect(keys).toContainEqual(
			expect.objectContaining({
				key: 'PAYMENTS_CREDENTIALS',
				kind: 'credential',
				set: false,
			}),
		);
	});
});
