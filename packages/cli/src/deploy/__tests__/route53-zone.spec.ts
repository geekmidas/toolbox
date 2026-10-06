/**
 * Route53 against a hosted zone on the AWS emulator: deleting records, zones
 * larger than one page, records gkm does not manage, and credentials from a
 * named profile.
 *
 * The one fault the emulator cannot be asked for — a change batch refused
 * after the zone was read — is injected with MSW; every other request passes
 * through to the emulator.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ChangeResourceRecordSetsCommand,
	CreateHostedZoneCommand,
	DeleteHostedZoneCommand,
	ListResourceRecordSetsCommand,
	Route53Client,
} from '@aws-sdk/client-route-53';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { Route53Provider } from '../dns/Route53Provider';

const ENDPOINT = LOCALSTACK_URL;
const DOMAIN = 'route53-zone.test';

describe('Route53Provider against a hosted zone', () => {
	const server = setupServer();
	let client: Route53Client;
	let zoneId: string;
	let provider: Route53Provider;

	const records = async () => {
		const response = await client.send(
			new ListResourceRecordSetsCommand({ HostedZoneId: zoneId }),
		);
		return (response.ResourceRecordSets ?? []).filter(
			(r) => r.Type !== 'NS' && r.Type !== 'SOA',
		);
	};

	beforeAll(async () => {
		server.listen({ onUnhandledRequest: 'bypass' });
		client = new Route53Client({
			region: 'us-east-1',
			endpoint: ENDPOINT,
			credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
		});
		const created = await client.send(
			new CreateHostedZoneCommand({
				Name: DOMAIN,
				CallerReference: `route53-zone-${Date.now()}`,
			}),
		);
		zoneId = created.HostedZone!.Id!.replace('/hostedzone/', '');
	});

	beforeEach(() => {
		vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
		vi.stubEnv('AWS_REGION', 'us-east-1');
		provider = new Route53Provider({ endpoint: ENDPOINT });
	});

	afterEach(async () => {
		server.resetHandlers();
		vi.unstubAllEnvs();
		const left = await records();
		if (left.length > 0) {
			await client.send(
				new ChangeResourceRecordSetsCommand({
					HostedZoneId: zoneId,
					ChangeBatch: {
						Changes: left.map((r) => ({
							Action: 'DELETE',
							ResourceRecordSet: r,
						})),
					},
				}),
			);
		}
	});

	afterAll(async () => {
		server.close();
		await client.send(new DeleteHostedZoneCommand({ Id: zoneId }));
		client.destroy();
	});

	const a = (name: string, value = '1.2.3.4') => ({
		name,
		type: 'A' as const,
		ttl: 300,
		value,
	});

	describe('deleteRecords', () => {
		it('deletes what exists and reports the rest as not found', async () => {
			await provider.upsertRecords(DOMAIN, [a('api'), a('@', '5.6.7.8')]);

			const results = await provider.deleteRecords(DOMAIN, [
				{ name: 'api', type: 'A' },
				{ name: '@', type: 'A' },
				{ name: 'gone', type: 'A' },
			]);

			expect(
				results.map((r) => [r.record.name, r.deleted, r.notFound]),
			).toEqual([
				['api', true, false],
				['@', true, false],
				['gone', false, true],
			]);
			expect(await records()).toEqual([]);
		});

		it('reports each record as failed when the change is refused', async () => {
			await provider.upsertRecords(DOMAIN, [a('api')]);
			server.use(
				http.post(`${ENDPOINT}/2013-04-01/hostedzone/:id/rrset*`, () =>
					HttpResponse.xml(
						'<ErrorResponse><Error><Type>Sender</Type><Code>InvalidChangeBatch</Code><Message>Tried to delete resource record set but it was not found</Message></Error></ErrorResponse>',
						{ status: 400 },
					),
				),
			);

			const [result] = await provider.deleteRecords(DOMAIN, [
				{ name: 'api', type: 'A' },
			]);

			expect(result).toMatchObject({ deleted: false, notFound: false });
			expect(result?.error).toContain('InvalidChangeBatch');
			expect(await records()).toHaveLength(1);
		});
	});

	it('reads a zone larger than one page, written in more than one batch', async () => {
		const many = Array.from({ length: 105 }, (_, i) =>
			a(`host${String(i).padStart(3, '0')}`),
		);

		const written = await provider.upsertRecords(DOMAIN, many);

		expect(written.every((r) => r.created)).toBe(true);
		const read = await provider.getRecords(DOMAIN);
		expect(read).toHaveLength(105);
		expect(new Set(read.map((r) => r.name)).size).toBe(105);
	});

	it('leaves out records of a type it does not manage', async () => {
		await client.send(
			new ChangeResourceRecordSetsCommand({
				HostedZoneId: zoneId,
				ChangeBatch: {
					Changes: [
						{
							Action: 'CREATE',
							ResourceRecordSet: {
								Name: `4.3.2.1.${DOMAIN}`,
								Type: 'PTR',
								TTL: 60,
								ResourceRecords: [{ Value: `api.${DOMAIN}` }],
							},
						},
					],
				},
			}),
		);
		await provider.upsertRecords(DOMAIN, [a('api')]);

		const read = await provider.getRecords(DOMAIN);

		expect(read).toEqual([
			{ name: 'api', type: 'A', ttl: 300, values: ['1.2.3.4'] },
		]);
	});

	it('takes a domain written with its trailing dot', async () => {
		await provider.upsertRecords(DOMAIN, [a('@')]);

		const read = await provider.getRecords(`${DOMAIN}.`);

		expect(read).toEqual([
			{ name: '@', type: 'A', ttl: 300, values: ['1.2.3.4'] },
		]);
	});

	it('finds the zone once and reuses it for the domain', async () => {
		await provider.upsertRecords(DOMAIN, [a('api')]);
		let lookups = 0;
		server.events.on('request:start', ({ request }) => {
			if (new URL(request.url).pathname.endsWith('/hostedzonesbyname')) {
				lookups++;
			}
		});

		await provider.getRecords(DOMAIN);
		await provider.getRecords(DOMAIN);

		expect(lookups).toBe(0);
		server.events.removeAllListeners();
	});

	it('signs with the named profile’s credentials', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'gkm-route53-aws-'));
		const credentials = join(dir, 'credentials');
		writeFileSync(
			credentials,
			'[gkm-dns]\naws_access_key_id = test\naws_secret_access_key = test\n',
		);
		vi.stubEnv('AWS_ACCESS_KEY_ID', undefined);
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', undefined);
		vi.stubEnv('AWS_REGION', undefined);
		vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', credentials);
		vi.stubEnv('AWS_CONFIG_FILE', join(dir, 'config'));

		try {
			const profiled = new Route53Provider({
				endpoint: ENDPOINT,
				profile: 'gkm-dns',
				hostedZoneId: zoneId,
			});

			await expect(profiled.getRecords(DOMAIN)).resolves.toEqual([]);

			const missing = new Route53Provider({
				endpoint: ENDPOINT,
				profile: 'no-such-profile',
				hostedZoneId: zoneId,
			});
			await expect(missing.getRecords(DOMAIN)).rejects.toThrow(
				/no-such-profile/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
