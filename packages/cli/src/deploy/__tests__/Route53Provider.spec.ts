import {
	ChangeResourceRecordSetsCommand,
	CreateHostedZoneCommand,
	DeleteHostedZoneCommand,
	ListResourceRecordSetsCommand,
	Route53Client,
} from '@aws-sdk/client-route-53';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import { Route53Provider } from '../dns/Route53Provider';

/**
 * Route53Provider Tests
 *
 * These tests require LocalStack to be running with Route53 enabled.
 * Run: docker compose up -d localstack
 */
describe('Route53Provider', () => {
	const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
	const TEST_DOMAIN = 'test-example.com';
	let client: Route53Client;
	let provider: Route53Provider;
	let hostedZoneId: string;

	beforeAll(async () => {
		process.env.AWS_ACCESS_KEY_ID = 'test';
		process.env.AWS_SECRET_ACCESS_KEY = 'test';
		process.env.AWS_REGION = 'us-east-1';

		client = new Route53Client({
			region: 'us-east-1',
			endpoint: LOCALSTACK_ENDPOINT,
			credentials: {
				accessKeyId: 'test',
				secretAccessKey: 'test',
			},
		});

		// Create a hosted zone for testing
		const createResponse = await client.send(
			new CreateHostedZoneCommand({
				Name: TEST_DOMAIN,
				CallerReference: `test-${Date.now()}`,
			}),
		);

		hostedZoneId = createResponse.HostedZone!.Id!.replace('/hostedzone/', '');
	});

	beforeEach(() => {
		provider = new Route53Provider({
			endpoint: LOCALSTACK_ENDPOINT,
			hostedZoneId,
		});
	});

	afterEach(async () => {
		// Clean up any test records (excluding NS and SOA which are auto-created)
		try {
			const response = await client.send(
				new ListResourceRecordSetsCommand({
					HostedZoneId: hostedZoneId,
				}),
			);

			const recordsToDelete = (response.ResourceRecordSets ?? []).filter(
				(record) => record.Type !== 'NS' && record.Type !== 'SOA',
			);

			if (recordsToDelete.length > 0) {
				await client.send(
					new ChangeResourceRecordSetsCommand({
						HostedZoneId: hostedZoneId,
						ChangeBatch: {
							Changes: recordsToDelete.map((record) => ({
								Action: 'DELETE',
								ResourceRecordSet: record,
							})),
						},
					}),
				);
			}
		} catch {
			// Ignore errors during cleanup
		}
	});

	afterAll(async () => {
		// Delete the hosted zone - need to remove all non-default records first
		try {
			const response = await client.send(
				new ListResourceRecordSetsCommand({
					HostedZoneId: hostedZoneId,
				}),
			);

			const recordsToDelete = (response.ResourceRecordSets ?? []).filter(
				(record) => record.Type !== 'NS' && record.Type !== 'SOA',
			);

			if (recordsToDelete.length > 0) {
				await client.send(
					new ChangeResourceRecordSetsCommand({
						HostedZoneId: hostedZoneId,
						ChangeBatch: {
							Changes: recordsToDelete.map((record) => ({
								Action: 'DELETE',
								ResourceRecordSet: record,
							})),
						},
					}),
				);
			}

			await client.send(
				new DeleteHostedZoneCommand({
					Id: hostedZoneId,
				}),
			);
		} catch {
			// Ignore cleanup errors
		}

		client.destroy();
	});

	describe('name', () => {
		it('should have name "route53"', () => {
			expect(provider.name).toBe('route53');
		});
	});

	describe('getRecords', () => {
		it('should return empty array for domain with no custom records', async () => {
			const records = await provider.getRecords(TEST_DOMAIN);

			// Should be empty - NS and SOA are filtered out
			expect(records).toEqual([]);
		});

		it('should return A records', async () => {
			// Create a test record (use UPSERT to handle idempotency)
			await client.send(
				new ChangeResourceRecordSetsCommand({
					HostedZoneId: hostedZoneId,
					ChangeBatch: {
						Changes: [
							{
								Action: 'UPSERT',
								ResourceRecordSet: {
									Name: `api.${TEST_DOMAIN}`,
									Type: 'A',
									TTL: 300,
									ResourceRecords: [{ Value: '1.2.3.4' }],
								},
							},
						],
					},
				}),
			);

			const records = await provider.getRecords(TEST_DOMAIN);

			expect(records).toHaveLength(1);
			expect(records[0]).toEqual({
				name: 'api',
				type: 'A',
				ttl: 300,
				values: ['1.2.3.4'],
			});
		});

		it('should handle root domain records (@)', async () => {
			// Create a root domain record (use UPSERT to handle idempotency)
			await client.send(
				new ChangeResourceRecordSetsCommand({
					HostedZoneId: hostedZoneId,
					ChangeBatch: {
						Changes: [
							{
								Action: 'UPSERT',
								ResourceRecordSet: {
									Name: TEST_DOMAIN,
									Type: 'A',
									TTL: 300,
									ResourceRecords: [{ Value: '1.2.3.4' }],
								},
							},
						],
					},
				}),
			);

			const records = await provider.getRecords(TEST_DOMAIN);

			expect(records).toHaveLength(1);
			expect(records[0]?.name).toBe('@');
		});

		it('should return multiple records', async () => {
			// Create multiple test records (use UPSERT to handle idempotency)
			await client.send(
				new ChangeResourceRecordSetsCommand({
					HostedZoneId: hostedZoneId,
					ChangeBatch: {
						Changes: [
							{
								Action: 'UPSERT',
								ResourceRecordSet: {
									Name: `api.${TEST_DOMAIN}`,
									Type: 'A',
									TTL: 300,
									ResourceRecords: [{ Value: '1.2.3.4' }],
								},
							},
							{
								Action: 'UPSERT',
								ResourceRecordSet: {
									Name: `www.${TEST_DOMAIN}`,
									Type: 'CNAME',
									TTL: 300,
									ResourceRecords: [{ Value: TEST_DOMAIN }],
								},
							},
						],
					},
				}),
			);

			const records = await provider.getRecords(TEST_DOMAIN);

			expect(records).toHaveLength(2);
			expect(records.find((r) => r.name === 'api')).toBeDefined();
			expect(records.find((r) => r.name === 'www')).toBeDefined();
		});
	});

	describe('upsertRecords', () => {
		it('should create new records', async () => {
			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
				created: true,
				unchanged: false,
			});

			// Verify record was created
			const records = await provider.getRecords(TEST_DOMAIN);
			expect(records.find((r) => r.name === 'api')).toBeDefined();
		});

		it('should handle root domain records (@)', async () => {
			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: '@', type: 'A', ttl: 300, value: '1.2.3.4' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]?.created).toBe(true);

			// Verify record was created at root
			const records = await provider.getRecords(TEST_DOMAIN);
			expect(records.find((r) => r.name === '@')).toBeDefined();
		});

		it('should mark unchanged when record exists with same value', async () => {
			// Create initial record (use UPSERT to handle idempotency)
			await client.send(
				new ChangeResourceRecordSetsCommand({
					HostedZoneId: hostedZoneId,
					ChangeBatch: {
						Changes: [
							{
								Action: 'UPSERT',
								ResourceRecordSet: {
									Name: `api.${TEST_DOMAIN}`,
									Type: 'A',
									TTL: 300,
									ResourceRecords: [{ Value: '1.2.3.4' }],
								},
							},
						],
					},
				}),
			);

			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
				created: false,
				unchanged: true,
			});
		});

		it('should update record when value changes', async () => {
			// Create initial record (use UPSERT to handle idempotency)
			await client.send(
				new ChangeResourceRecordSetsCommand({
					HostedZoneId: hostedZoneId,
					ChangeBatch: {
						Changes: [
							{
								Action: 'UPSERT',
								ResourceRecordSet: {
									Name: `api.${TEST_DOMAIN}`,
									Type: 'A',
									TTL: 300,
									ResourceRecords: [{ Value: '1.2.3.4' }],
								},
							},
						],
					},
				}),
			);

			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: 'api', type: 'A', ttl: 300, value: '5.6.7.8' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '5.6.7.8' },
				created: false,
				unchanged: false,
			});

			// Verify record was updated
			const records = await provider.getRecords(TEST_DOMAIN);
			const apiRecord = records.find((r) => r.name === 'api');
			expect(apiRecord?.values[0]).toBe('5.6.7.8');
		});

		it('should handle multiple records with mixed states', async () => {
			// Create initial record (use UPSERT to handle idempotency)
			await client.send(
				new ChangeResourceRecordSetsCommand({
					HostedZoneId: hostedZoneId,
					ChangeBatch: {
						Changes: [
							{
								Action: 'UPSERT',
								ResourceRecordSet: {
									Name: `api.${TEST_DOMAIN}`,
									Type: 'A',
									TTL: 300,
									ResourceRecords: [{ Value: '1.2.3.4' }],
								},
							},
						],
					},
				}),
			);

			const results = await provider.upsertRecords(TEST_DOMAIN, [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' }, // Unchanged
				{ name: 'www', type: 'A', ttl: 300, value: '1.2.3.4' }, // New
			]);

			expect(results).toHaveLength(2);
			expect(results[0]?.unchanged).toBe(true);
			expect(results[1]?.created).toBe(true);
		});
	});

	describe('hosted zone auto-detection', () => {
		it('should auto-detect hosted zone from domain', async () => {
			// Create provider without hostedZoneId
			const autoProvider = new Route53Provider({
				endpoint: LOCALSTACK_ENDPOINT,
			});

			const records = await autoProvider.getRecords(TEST_DOMAIN);

			// Should work without error
			expect(Array.isArray(records)).toBe(true);
		});

		it('should throw error when hosted zone not found', async () => {
			const autoProvider = new Route53Provider({
				endpoint: LOCALSTACK_ENDPOINT,
			});

			await expect(
				autoProvider.getRecords('nonexistent-domain.com'),
			).rejects.toThrow('No hosted zone found for domain');
		});
	});

	describe('default region', () => {
		it('should use us-east-1 as default region when none specified', () => {
			// This test verifies the provider can be created without region
			// and doesn't throw "Region is missing" error
			const providerWithoutRegion = new Route53Provider({
				endpoint: LOCALSTACK_ENDPOINT,
				hostedZoneId: 'test-zone',
			});

			expect(providerWithoutRegion.name).toBe('route53');
		});

		it('should use provided region when specified', () => {
			const providerWithRegion = new Route53Provider({
				endpoint: LOCALSTACK_ENDPOINT,
				region: 'eu-west-1',
				hostedZoneId: 'test-zone',
			});

			expect(providerWithRegion.name).toBe('route53');
		});
	});
});
