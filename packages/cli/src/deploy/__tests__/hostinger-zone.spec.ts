/**
 * Hostinger's DNS API against a zone held in memory: validating, deleting,
 * the single-record helpers, and how its failures surface.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { MissingCredential } from '../credentials';
import { HostingerProvider } from '../dns/HostingerProvider';
import {
	type DnsRecord,
	HostingerApi,
	HostingerApiError,
} from '../dns/hostinger-api';

const ZONE = 'https://developers.hostinger.com/api/dns/v1/zones/:domain';
const TOKEN = 'hostinger-token';

describe('Hostinger zone', () => {
	let zone: DnsRecord[];
	let validated: unknown[];
	let home: string;

	const server = setupServer(
		http.get(ZONE, () => HttpResponse.json(zone)),
		http.put(ZONE, async ({ request }) => {
			const body = (await request.json()) as { zone: DnsRecord[] };
			for (const record of body.zone) {
				zone = zone.filter(
					(r) => !(r.name === record.name && r.type === record.type),
				);
				zone.push(record);
			}
			return new HttpResponse(null, { status: 204 });
		}),
		http.post(`${ZONE}/validate`, async ({ request }) => {
			validated.push(await request.json());
			return HttpResponse.json({});
		}),
		http.delete(ZONE, async ({ request }) => {
			const { filters } = (await request.json()) as {
				filters: { name: string; type: string }[];
			};
			zone = zone.filter(
				(r) => !filters.some((f) => f.name === r.name && f.type === r.type),
			);
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const a = (name: string, ip: string): DnsRecord => ({
		name,
		type: 'A',
		ttl: 300,
		records: [{ content: ip }],
	});

	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());

	beforeEach(() => {
		zone = [a('api', '1.2.3.4'), a('www', '1.2.3.4')];
		validated = [];
		home = mkdtempSync(join(tmpdir(), 'gkm-hostinger-home-'));
		vi.stubEnv('HOME', home);
		// The CLI's home under that HOME, not the suite's shared GKM_HOME.
		vi.stubEnv('GKM_HOME', undefined);
		vi.stubEnv('HOSTINGER_API_TOKEN', TOKEN);
	});

	afterEach(() => {
		server.resetHandlers();
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
	});

	describe('HostingerApi', () => {
		const api = () => new HostingerApi(TOKEN);

		it('validates records without applying them', async () => {
			await expect(
				api().validateRecords('shop.com', [a('docs', '5.6.7.8')]),
			).resolves.toBe(true);

			expect(validated).toEqual([
				{ overwrite: false, zone: [a('docs', '5.6.7.8')] },
			]);
			expect(zone.map((r) => r.name)).toEqual(['api', 'www']);
		});

		it('deletes the records a filter names', async () => {
			await api().deleteRecords('shop.com', [{ name: 'api', type: 'A' }]);

			expect(zone.map((r) => r.name)).toEqual(['www']);
		});

		it('knows whether a record exists, by name and type', async () => {
			await expect(api().recordExists('shop.com', 'api')).resolves.toBe(true);
			await expect(api().recordExists('shop.com', 'api', 'AAAA')).resolves.toBe(
				false,
			);
		});

		it('creates an A record only when there is none', async () => {
			await expect(
				api().createARecordIfNotExists('shop.com', 'api', '9.9.9.9'),
			).resolves.toBe(false);
			await expect(
				api().createARecordIfNotExists('shop.com', 'docs', '9.9.9.9', 60),
			).resolves.toBe(true);

			expect(zone).toContainEqual({ ...a('docs', '9.9.9.9'), ttl: 60 });
			expect(zone).toContainEqual(a('api', '1.2.3.4'));
		});

		it('carries the field errors Hostinger reports', async () => {
			server.use(
				http.post(`${ZONE}/validate`, () =>
					HttpResponse.json(
						{
							message: 'The given data was invalid.',
							errors: { 'zone.0.name': ['Name is required'] },
						},
						{ status: 422 },
					),
				),
			);

			const error = await api()
				.validateRecords('shop.com', [a('', '1.2.3.4')])
				.catch((e) => e);

			expect(error).toBeInstanceOf(HostingerApiError);
			expect(error).toMatchObject({
				message: 'Hostinger API error: The given data was invalid.',
				status: 422,
				errors: { 'zone.0.name': ['Name is required'] },
			});
		});

		it('falls back to the status when the error body is not JSON', async () => {
			server.use(
				http.get(
					ZONE,
					() =>
						new HttpResponse('upstream down', {
							status: 502,
							statusText: 'Bad Gateway',
						}),
				),
			);

			await expect(api().getRecords('shop.com')).rejects.toMatchObject({
				message: 'Hostinger API error: 502 Bad Gateway',
				errors: undefined,
			});
		});

		it('reads an empty body as an empty zone', async () => {
			server.use(http.get(ZONE, () => new HttpResponse('', { status: 200 })));

			await expect(api().getRecords('shop.com')).resolves.toEqual([]);
		});
	});

	describe('HostingerProvider.deleteRecords', () => {
		it('deletes what exists and reports the rest as not found', async () => {
			const results = await new HostingerProvider().deleteRecords('shop.com', [
				{ name: 'api', type: 'A' },
				{ name: 'gone', type: 'A' },
			]);

			expect(results).toEqual([
				{ record: { name: 'api', type: 'A' }, deleted: true, notFound: false },
				{ record: { name: 'gone', type: 'A' }, deleted: false, notFound: true },
			]);
			expect(zone.map((r) => r.name)).toEqual(['www']);
		});

		it('sends no delete when nothing it names exists', async () => {
			server.use(
				http.delete(ZONE, () => {
					throw new Error('should not be called');
				}),
			);

			const results = await new HostingerProvider().deleteRecords('shop.com', [
				{ name: 'gone', type: 'CNAME' },
			]);

			expect(results).toEqual([
				{
					record: { name: 'gone', type: 'CNAME' },
					deleted: false,
					notFound: true,
				},
			]);
		});

		it('reports every record as failed when the delete is refused', async () => {
			server.use(
				http.delete(ZONE, () =>
					HttpResponse.json({ message: 'Zone locked' }, { status: 423 }),
				),
			);

			const results = await new HostingerProvider().deleteRecords('shop.com', [
				{ name: 'api', type: 'A' },
				{ name: 'www', type: 'A' },
			]);

			expect(results.map((r) => [r.deleted, r.error])).toEqual([
				[false, 'HostingerApiError: Hostinger API error: Zone locked'],
				[false, 'HostingerApiError: Hostinger API error: Zone locked'],
			]);
			expect(zone).toHaveLength(2);
		});
	});

	it('says how to log in when no token is configured', async () => {
		vi.stubEnv('HOSTINGER_API_TOKEN', undefined);

		const error = await new HostingerProvider()
			.getRecords('shop.com')
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(MissingCredential);
		expect((error as MissingCredential).kind).toBe('hostinger');
		expect((error as Error).message).toContain('HOSTINGER_API_TOKEN');
		expect((error as Error).message).toContain(
			'gkm login --provider hostinger',
		);
	});
});
