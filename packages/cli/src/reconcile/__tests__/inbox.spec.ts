import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { composeFor } from '../compose';
import { envFor } from '../env';
import {
	INBOX_RELAY_TOKEN_KEY,
	InboxSubscribersSpanWorkers,
	inboxRelayToken,
	inboxRelayWorker,
	inboxWebhookUrl,
} from '../inboxRelay';
import { planFor } from '../plan';
import { TEST_CREDENTIALS } from './__helpers__/credentials';

/**
 * An inbox, as `new Inbox('Requests', …)` declares it — its topic, then itself
 * — beside the database pg-boss carries the topic in locally.
 */
const MANIFEST = {
	Store: { kind: 'database', id: 'Store', provides: ['STORE_URL'] },
	RequestsMail: {
		kind: 'topic',
		id: 'RequestsMail',
		provides: ['REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING'],
		events: ['email.received'],
		subscribers: [],
	},
	Requests: {
		kind: 'inbox',
		id: 'Requests',
		provides: ['REQUESTS_URL', 'REQUESTS_DOMAIN'],
		addresses: ['requests'],
		subdomains: true,
		topic: 'RequestsMail',
	},
} as unknown as ConstructManifest;

const plan = (stage: string) =>
	planFor(MANIFEST, stage, provisionOrder(MANIFEST), {
		localStage: 'development',
	});

const PORTS = { mailpit: 41025, 'mailpit-web': 48025, postgres: 45432 };

describe('an inbox, planned locally', () => {
	it('runs on Mailpit, and needs no bucket: Mailpit keeps what it receives', () => {
		const planned = plan('development');

		expect(planned.containers).toContain('mailpit');
		expect(planned.containers).not.toContain('minio');
		expect(planned.resources.find((r) => r.id === 'Requests')).toMatchObject({
			kind: 'inbox',
			container: 'mailpit',
			envKey: 'REQUESTS_URL',
			inbox: {
				addresses: ['requests'],
				subdomains: true,
				topic: 'RequestsMail',
			},
		});
	});

	it("resolves its store to Mailpit's API, its domain to the project's, and where mail is delivered to it", () => {
		const env = envFor(plan('development'), {
			ports: PORTS,
			project: 'fixwell',
			credentials: TEST_CREDENTIALS,
			seed: TEST_CREDENTIALS.seed,
		});

		expect(env).toMatchObject({
			REQUESTS_URL: 'http://localhost:48025',
			REQUESTS_DOMAIN: 'fixwell.localhost',
			REQUESTS_SMTP_URL: 'smtp://localhost:41025',
			[INBOX_RELAY_TOKEN_KEY]: inboxRelayToken(
				'fixwell',
				TEST_CREDENTIALS.seed,
			),
		});
		// Its raw messages are Mailpit's to serve: no S3 key pair is resolved.
		expect(env).not.toHaveProperty('AWS_ACCESS_KEY_ID');
	});

	it('gives every stage but the local one a label of its own, so `gkm test` never receives what `gkm dev` does', () => {
		const env = envFor(plan('test'), {
			ports: PORTS,
			project: 'fixwell',
			credentials: TEST_CREDENTIALS,
		});

		expect(env.REQUESTS_DOMAIN).toBe('test.fixwell.localhost');
	});

	it("points Mailpit's webhook at the relay, so a change recreates it", () => {
		const url = inboxWebhookUrl('http://host.docker.internal:3001', 'tok/en');
		const compose = composeFor(plan('development'), {
			project: 'fixwell',
			ports: PORTS,
			credentials: TEST_CREDENTIALS,
			inboxRelay: url,
		});

		expect(url).toBe(
			'http://host.docker.internal:3001/__gkm/inbox?token=tok%2Fen',
		);
		expect(compose.services.mailpit?.environment).toMatchObject({
			MP_WEBHOOK_URL: url,
		});
		expect(compose.services.mailpit?.extra_hosts).toEqual([
			'host.docker.internal:host-gateway',
		]);
	});
});

describe('which worker receives locally', () => {
	const bound = (name: string) => ({
		name,
		connectionKey: 'REQUESTS_MAIL_PUBLISHER_CONNECTION_STRING',
	});

	it('is the one that runs the inbox subscribers', () => {
		expect(
			inboxRelayWorker(MANIFEST, {
				Jobs: [bound('onRequest'), bound('onReply')],
				Reports: [{ name: 'onOrder', connectionKey: 'ORDERS_URL' }],
			}),
		).toBe('Jobs');
	});

	it('is none without an inbox subscriber', () => {
		expect(inboxRelayWorker(MANIFEST, {})).toBeUndefined();
	});

	it('is refused across workers, naming them: Mailpit posts to one webhook (#343)', () => {
		const refused = () =>
			inboxRelayWorker(MANIFEST, {
				Jobs: [bound('onRequest')],
				Support: [bound('onReply')],
			});

		expect(refused).toThrow(InboxSubscribersSpanWorkers);
		expect(refused).toThrow(/'Jobs' and 'Support'/);
	});
});
