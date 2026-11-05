import { resolveEnvKeys } from '@geekmidas/envkit/sst';
import * as snsUrl from '@geekmidas/events/sns/url';
import { type ConstructManifest, providedKeyFor } from '@geekmidas/manifest';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Inbox, InboxNotProvisioned, InboxTopic } from '../aws/Inbox';
import { Topic } from '../aws/Topic';
import { fromManifest } from '../fromManifest';

/**
 * An inbox on SST: what receives the mail is its provider's, made before SST
 * runs — so SST creates no topic for it, subscribes the inbox's Lambda to the
 * provider's topic, and links the inbox's values the deploy handed it.
 */

const stack = {} as never;
const TOPIC_ARN =
	'arn:aws:sns:eu-west-1:123456789012:gkm-shop-production-requests';
const URL = 's3://AKIA:secret@shop-production-requests-mail?region=eu-west-1';

const external = (
	globalThis as unknown as {
		sst: {
			aws: {
				SnsTopic: {
					external: {
						name: string;
						topicArn: unknown;
						subscriber: { handler: string; link: unknown[] };
						args: unknown;
					}[];
				};
			};
		};
	}
).sst.aws.SnsTopic.external;

function manifest(): ConstructManifest {
	return {
		Requests: {
			kind: 'inbox',
			id: 'Requests',
			addresses: ['requests'],
			subdomains: true,
			topic: 'RequestsMail',
			provides: ['REQUESTS_URL', 'REQUESTS_DOMAIN'],
		},
		RequestsMail: {
			kind: 'topic',
			id: 'RequestsMail',
			events: ['email.received'],
			provides: [
				providedKeyFor('RequestsMail', 'topic', 'publisherConnectionString'),
			],
			subscribers: [
				{
					id: 'OnRequest',
					handler: '.gkm/aws-lambda/subscribers/onRequest.handler',
					dependencies: [{ target: 'Requests', kind: 'inbox' }],
					events: [],
				},
			],
		},
		// A topic of the app's own, beside it: still SST's to create.
		Users: {
			kind: 'topic',
			id: 'Users',
			events: ['user.created'],
			provides: [providedKeyFor('Users', 'topic', 'publisherConnectionString')],
			subscribers: [],
		},
	} as unknown as ConstructManifest;
}

const env = {
	REQUESTS_URL: URL,
	REQUESTS_DOMAIN: 'shop.example',
	[providedKeyFor('RequestsMail', 'topic', 'publisherConnectionString')]:
		snsUrl.build({
			topicArn: TOPIC_ARN,
			region: 'eu-west-1',
		}),
};

beforeEach(() => {
	external.length = 0;
});

describe('an inbox on SST', () => {
	it('references the provider’s topic instead of creating one', () => {
		const provisioned = fromManifest(stack, manifest(), {
			Requests: { env },
		} as never);

		expect(provisioned.RequestsMail).toBeInstanceOf(InboxTopic);
		expect((provisioned.RequestsMail as unknown as InboxTopic).arn).toBe(
			TOPIC_ARN,
		);
		expect(provisioned.Users).toBeInstanceOf(Topic);
	});

	it('subscribes the inbox’s Lambda to that topic, unfiltered, linked to its inbox', () => {
		const provisioned = fromManifest(stack, manifest(), {
			Requests: { env },
		} as never);

		expect(external).toHaveLength(1);
		const [subscription] = external;
		expect(subscription).toMatchObject({
			name: 'OnRequestSubscription',
			topicArn: TOPIC_ARN,
			subscriber: {
				handler: '.gkm/aws-lambda/subscribers/onRequest.handler',
			},
		});
		// No filter policy: SES's notification has no `type` to filter on.
		expect(subscription!.args).toBeUndefined();
		expect(subscription!.subscriber.link).toEqual([provisioned.Requests]);
	});

	it('hands the Lambda the inbox’s keys, with the deploy’s values', () => {
		const provisioned = fromManifest(stack, manifest(), {
			Requests: { env },
		} as never);
		const inbox = provisioned.Requests as unknown as Inbox;

		expect(inbox.getSSTLink().properties).toEqual({
			url: URL,
			domain: 'shop.example',
		});
		expect(
			resolveEnvKeys({ Requests: { type: inbox._type as string } }),
		).toEqual(['REQUESTS_URL', 'REQUESTS_DOMAIN']);
	});

	it('takes the values passed to it over the deploy’s', () => {
		const provisioned = fromManifest(stack, manifest(), {
			Requests: { env, domain: 'mail.shop.example' },
		} as never);

		expect((provisioned.Requests as unknown as Inbox).provides().domain).toBe(
			'mail.shop.example',
		);
	});

	it('fails naming the key when the provider has not made it', () => {
		const partial = { ...env, REQUESTS_URL: undefined };

		expect(() =>
			fromManifest(stack, manifest(), { Requests: { env: partial } } as never),
		).toThrow(InboxNotProvisioned);
		try {
			fromManifest(stack, manifest(), { Requests: { env: partial } } as never);
		} catch (error) {
			expect((error as InboxNotProvisioned).key).toBe('REQUESTS_URL');
		}
	});
});
