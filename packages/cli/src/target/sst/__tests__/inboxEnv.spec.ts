import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { StageSecretMissing } from '../../../compose/stack';
import type { StageSecrets } from '../../../secrets/types';
import { NoDomainForStage } from '../../dokploy/domain';
import type { DeployPhaseContext } from '../../types';
import { inboxEnv } from '../index';

/**
 * What `sst deploy` is handed for each inbox: what its provider made, read
 * from the stage's secrets by the rule the compose stack reads it by, and
 * the stage's domain. The access keys in it are masked; the domain is not.
 */

const manifest = {
	Requests: {
		kind: 'inbox',
		id: 'Requests',
		addresses: ['requests'],
		topic: 'RequestsMail',
		provides: ['REQUESTS_URL', 'REQUESTS_DOMAIN'],
	},
	RequestsMail: {
		kind: 'topic',
		id: 'RequestsMail',
		events: ['email.received'],
		provides: ['REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING'],
		subscribers: [],
	},
} as unknown as ConstructManifest;

const URL = 's3://AKIA:secret@shop-production-requests-mail?region=eu-west-1';
const TOPIC =
	'sns://AKIA:secret@?topicArn=arn%3Aaws%3Asns%3Aeu-west-1%3A1%3Arequests';

function context(options: {
	manifest?: ConstructManifest;
	custom?: Record<string, string>;
	domain?: string;
}) {
	const masked: string[] = [];
	const ctx = {
		stage: 'production',
		manifest: options.manifest ?? manifest,
		workspace: {
			domains: options.domain ? { production: options.domain } : {},
		},
		secrets: {
			read: async () =>
				({ custom: options.custom ?? {} }) as unknown as StageSecrets,
			mask: (value: string) => masked.push(value),
		},
	} as unknown as DeployPhaseContext<unknown>;
	return { ctx, masked };
}

describe('inboxEnv', () => {
	it('hands SST the provider’s values and the stage’s domain, masking the keys', async () => {
		const { ctx, masked } = context({
			custom: {
				REQUESTS_URL: URL,
				REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING: TOPIC,
				UNRELATED: 'x',
			},
			domain: 'shop.example',
		});

		expect(await inboxEnv(ctx)).toEqual({
			REQUESTS_URL: URL,
			REQUESTS_DOMAIN: 'shop.example',
			REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING: TOPIC,
		});
		expect(masked.sort()).toEqual([TOPIC, URL].sort());
	});

	it('is empty, and reads nothing, without an inbox', async () => {
		const { ctx } = context({ manifest: {} as ConstructManifest });

		expect(await inboxEnv(ctx)).toEqual({});
	});

	it('fails naming the key the provider has not written', async () => {
		const { ctx } = context({
			custom: { REQUESTS_URL: URL },
			domain: 'shop.example',
		});

		const error = await inboxEnv(ctx).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(StageSecretMissing);
		expect((error as StageSecretMissing).key).toBe(
			'REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING',
		);
	});

	it('fails when the stage has no domain to receive at', async () => {
		const { ctx } = context({
			custom: {
				REQUESTS_URL: URL,
				REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING: TOPIC,
			},
		});

		await expect(inboxEnv(ctx)).rejects.toBeInstanceOf(NoDomainForStage);
	});
});
