import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { deployedInboxEnv } from '../stack';

const inbox = (id: string, extra: Record<string, unknown>) => ({
	[`${id}Mail`]: {
		kind: 'topic',
		id: `${id}Mail`,
		provides: [`${id.toUpperCase()}_MAIL_PUBLISHER_CONNECTION_STRING`],
		events: ['email.received'],
		subscribers: [],
	},
	[id]: {
		kind: 'inbox',
		id,
		provides: [`${id.toUpperCase()}_URL`, `${id.toUpperCase()}_DOMAIN`],
		addresses: ['pop'],
		topic: `${id}Mail`,
		...extra,
	},
});

describe("a deployed inbox's domain", () => {
	it("is the stage's, or its fixed subdomain's label in front of it", () => {
		const manifest = {
			...inbox('Requests', {}),
			...inbox('Inbound', { subdomain: 'in' }),
		} as unknown as ConstructManifest;
		const secrets = Object.fromEntries(
			[
				'REQUESTS_URL',
				'REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING',
				'INBOUND_URL',
				'INBOUND_MAIL_PUBLISHER_CONNECTION_STRING',
			].map((key) => [key, `s3://${key}`]),
		);

		const env = deployedInboxEnv(manifest, {
			reader: 'api',
			stage: 'production',
			domain: 'fixwell.example',
			secrets,
		});

		expect({
			requests: env.REQUESTS_DOMAIN,
			inbound: env.INBOUND_DOMAIN,
		}).toEqual({ requests: 'fixwell.example', inbound: 'in.fixwell.example' });
	});
});
