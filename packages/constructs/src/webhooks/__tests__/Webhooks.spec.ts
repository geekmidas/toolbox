import { randomBytes, randomUUID } from 'node:crypto';
import { EnvironmentParser } from '@geekmidas/envkit';
import { providedKeyFor } from '@geekmidas/manifest';
import { serviceContext } from '@geekmidas/services';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { TEST_DATABASE_CONFIG } from '../../../../testkit/test/globalSetup';
import { idsOf } from '../../construct-interface';
import { KyselyDatabase } from '../../database/kysely';
import { Encryption } from '../../encryption';
import { WebhookEventNotOnTopic } from '../../endpoints/webhooks';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import {
	assertDeliverableUrl,
	NoWebhookEvents,
	signingSecrets,
	UnknownWebhookEvent,
	WEBHOOK_TABLES_SQL,
	WebhookSubscriptionNotFound,
	WebhookUrlNotDeliverable,
} from '../index';

/**
 * The construct's storage and subscriptions, against a real Postgres tenant
 * and a real keyring: what a subscription stores, that its secret is
 * ciphertext, and how it is managed.
 */

const schema = `wh_${randomUUID().slice(0, 8)}`;
const { host, port, user, password, database } = TEST_DATABASE_CONFIG;
const url = `postgres://${user}:${password}@${host}:${port}/${database}?search_path=${schema}`;
const key = () => randomBytes(32).toString('base64url');

const billing = new Topic('Billing', {
	events: {
		'invoice.paid': z.object({ invoiceId: z.string() }),
		'invoice.voided': z.object({ invoiceId: z.string() }),
		'invoice.drafted': z.object({ invoiceId: z.string() }),
	},
});
const appDb = new KyselyDatabase('AppDb');
const tenant = appDb.schema('BillingHooksDb');
const pii = new Encryption('Pii');
const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });

const hooks = api.webhooks('BillingHooks', {
	topic: billing,
	events: ['invoice.paid', 'invoice.voided'],
	database: tenant,
	encryption: pii,
});

const envParser = new EnvironmentParser({
	[providedKeyFor(tenant.id, 'database-schema', 'url')]: url,
	[providedKeyFor(tenant.id, 'database-schema', 'ownerUrl')]: url,
	[providedKeyFor(pii.id, 'encryption', 'url')]:
		`aes256gcm://local?keys=k1.${key()}&index=${key()}`,
});
const register = { envParser, context: serviceContext };

const raw = new pg.Pool({ connectionString: url.replace(/\?.*$/, '') });

beforeAll(async () => {
	await raw.query(`CREATE SCHEMA ${schema}`);
});
afterAll(async () => {
	await raw.query(`DROP SCHEMA ${schema} CASCADE`);
	await raw.end();
});

describe('Webhooks', () => {
	it('is owned by the API it was built from, and declares what it reaches', () => {
		expect(hooks.owner).toBe('Api');
		expect(hooks.declare()).toEqual([
			// Its lifecycle topic, declared with it.
			{
				kind: 'topic',
				id: 'BillingHooksEvents',
				provides: ['BILLING_HOOKS_EVENTS_PUBLISHER_CONNECTION_STRING'],
				events: [
					'delivery.succeeded',
					'delivery.failed',
					'delivery.abandoned',
					'subscription.disabled',
					'secret.rotated',
				],
				subscribers: [],
			},
			{
				kind: 'webhooks',
				id: 'BillingHooks',
				owner: 'Api',
				topic: 'Billing',
				events: ['invoice.paid', 'invoice.voided'],
				database: 'BillingHooksDb',
				encryption: 'Pii',
			},
		]);
		// A runnable that depends on it is given edges to its tenant, its key
		// and its lifecycle topic.
		expect(idsOf([hooks])).toEqual([
			'BillingHooks',
			'BillingHooksDb',
			'Pii',
			'BillingHooksEvents',
		]);
	});

	it('delivers every event of the topic when it names none', () => {
		// Another API: `api` already owns hooks delivering these event types.
		const other = new RestApi('Other', {
			path: '.',
			defaultAuthorizer: 'none',
		});
		const all = other.webhooks('AllHooks', {
			topic: billing,
			database: tenant,
			encryption: pii,
		});
		expect(all.eventTypes).toEqual([
			'invoice.paid',
			'invoice.voided',
			'invoice.drafted',
		]);
	});

	it('refuses an event its topic does not carry', () => {
		expect(() =>
			api.webhooks('Bad', {
				topic: billing,
				events: ['invoice.payed' as never],
				database: tenant,
				encryption: pii,
			}),
		).toThrow(WebhookEventNotOnTopic);
	});

	it('asks for its tables until they exist, then for nothing', async () => {
		expect(await hooks.pendingMigration(register)).toBe(WEBHOOK_TABLES_SQL);

		await raw.query(`SET search_path TO ${schema}; ${WEBHOOK_TABLES_SQL}`);

		expect(await hooks.pendingMigration(register)).toBeUndefined();
		expect(hooks.databaseId).toBe('BillingHooksDb');
	});

	describe('subscriptions', () => {
		it('stores a subscription with an encrypted secret, returned once', async () => {
			const client = await hooks.service.register(register);
			const { subscription, secret } = await client.subscribe({
				owner: 'acct_1',
				url: 'https://acme.example/hooks',
				events: ['invoice.paid'],
			});

			expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
			expect(subscription).toMatchObject({
				owner: 'acct_1',
				url: 'https://acme.example/hooks',
				events: ['invoice.paid'],
				status: 'active',
			});
			expect(subscription).not.toHaveProperty('secret');

			const { rows } = await raw.query(
				`SELECT secret FROM ${schema}.webhook_subscriptions WHERE id = $1`,
				[subscription.id],
			);
			expect(rows[0].secret).not.toContain(secret);
		});

		it('lists an owner’s subscriptions, and no one else’s', async () => {
			const client = await hooks.service.register(register);
			await client.subscribe({
				owner: 'acct_2',
				url: 'https://two.example/a',
				events: ['invoice.paid'],
			});
			await client.subscribe({
				owner: 'acct_2',
				url: 'https://two.example/b',
				events: ['invoice.voided'],
			});

			const listed = await client.list('acct_2');
			expect(listed.map((s) => s.url).sort()).toEqual([
				'https://two.example/a',
				'https://two.example/b',
			]);
			expect(await client.list('acct_nobody')).toEqual([]);
		});

		it('disables and enables one', async () => {
			const client = await hooks.service.register(register);
			const { subscription } = await client.subscribe({
				owner: 'acct_3',
				url: 'https://three.example/hooks',
				events: ['invoice.paid'],
			});

			expect(
				await client.disable(subscription.id, 'paused by owner'),
			).toMatchObject({
				status: 'disabled',
				disabledReason: 'paused by owner',
			});
			expect(await client.enable(subscription.id)).toMatchObject({
				status: 'active',
				disabledReason: null,
			});
		});

		it('rotates a secret, the old one still signing until it expires', async () => {
			const client = await hooks.service.register(register);
			const cipher = await pii.service.register(register);
			const { subscription, secret: first } = await client.subscribe({
				owner: 'acct_4',
				url: 'https://four.example/hooks',
				events: ['invoice.paid'],
			});

			const { secret: second } = await client.rotateSecret(subscription.id, {
				overlapMs: 60_000,
			});
			expect(second).not.toBe(first);

			const { rows } = await raw.query(
				`SELECT secret, previous_secret, previous_secret_expires_at
				   FROM ${schema}.webhook_subscriptions WHERE id = $1`,
				[subscription.id],
			);
			expect(await signingSecrets(rows[0], cipher)).toEqual([second, first]);
			expect(
				await signingSecrets(rows[0], cipher, new Date(Date.now() + 120_000)),
			).toEqual([second]);
		});

		it('removes one', async () => {
			const client = await hooks.service.register(register);
			const { subscription } = await client.subscribe({
				owner: 'acct_5',
				url: 'https://five.example/hooks',
				events: ['invoice.paid'],
			});

			await client.remove(subscription.id);

			await expect(client.get(subscription.id)).rejects.toBeInstanceOf(
				WebhookSubscriptionNotFound,
			);
			await expect(client.remove(subscription.id)).rejects.toBeInstanceOf(
				WebhookSubscriptionNotFound,
			);
		});

		it('refuses events it does not send, and a subscription to none', async () => {
			const client = await hooks.service.register(register);
			const owner = 'acct_6';
			const target = 'https://six.example/hooks';

			await expect(
				client.subscribe({
					owner,
					url: target,
					events: ['invoice.drafted' as never],
				}),
			).rejects.toBeInstanceOf(UnknownWebhookEvent);
			await expect(
				client.subscribe({ owner, url: target, events: [] }),
			).rejects.toBeInstanceOf(NoWebhookEvents);
		});
	});
});

describe('assertDeliverableUrl', () => {
	it.each([
		['not a url', 'it is not a URL'],
		['http://acme.example/hooks', 'it is not https://'],
		['https://user:pw@acme.example/hooks', 'it carries credentials'],
		['https://localhost/hooks', 'is a local name'],
		['https://api.internal/hooks', 'is a local name'],
		['https://10.0.0.5/hooks', 'not a public address'],
		['https://169.254.169.254/latest', 'not a public address'],
		['https://100.64.0.1/hooks', 'not a public address'],
		['https://0.0.0.0/hooks', 'not a public address'],
		['https://[::1]/hooks', 'not a public address'],
		['https://[fd00::1]/hooks', 'not a public address'],
	])('refuses %s on a deployed stage', (target, reason) => {
		expect(() => assertDeliverableUrl(target, false)).toThrow(
			WebhookUrlNotDeliverable,
		);
		expect(() => assertDeliverableUrl(target, false)).toThrow(reason);
	});

	it('takes a public https URL', () => {
		expect(assertDeliverableUrl('https://acme.example/hooks', false).host).toBe(
			'acme.example',
		);
	});

	it('takes localhost over http when delivering locally', () => {
		expect(assertDeliverableUrl('http://localhost:4000/hooks', true).port).toBe(
			'4000',
		);
	});
});
