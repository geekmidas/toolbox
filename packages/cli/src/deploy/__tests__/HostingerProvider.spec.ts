import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the credentials module
vi.mock('../../auth/credentials', () => ({
	getHostingerToken: vi.fn(),
}));

// Mock the HostingerApi
vi.mock('../dns/hostinger-api', () => ({
	HostingerApi: vi.fn().mockImplementation(() => ({
		getRecords: vi.fn(),
		upsertRecords: vi.fn(),
	})),
}));

import { getHostingerToken } from '../../auth/credentials';
import { HostingerApi } from '../dns/hostinger-api';
import { HostingerProvider } from '../dns/HostingerProvider';

describe('HostingerProvider', () => {
	const mockGetHostingerToken = vi.mocked(getHostingerToken);
	let mockApi: {
		getRecords: ReturnType<typeof vi.fn>;
		upsertRecords: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetHostingerToken.mockResolvedValue('test-token');
		mockApi = {
			getRecords: vi.fn(),
			upsertRecords: vi.fn(),
		};
		vi.mocked(HostingerApi).mockImplementation(() => mockApi as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('name', () => {
		it('should have name "hostinger"', () => {
			const provider = new HostingerProvider();
			expect(provider.name).toBe('hostinger');
		});
	});

	describe('getRecords', () => {
		it('should throw error when token is not configured', async () => {
			mockGetHostingerToken.mockResolvedValue(null);

			const provider = new HostingerProvider();

			await expect(provider.getRecords('example.com')).rejects.toThrow(
				'Hostinger API token not configured',
			);
		});

		it('should return records from API', async () => {
			const mockRecords = [
				{
					name: 'api',
					type: 'A' as const,
					ttl: 300,
					records: [{ content: '1.2.3.4' }],
				},
				{
					name: 'www',
					type: 'CNAME' as const,
					ttl: 300,
					records: [{ content: 'example.com' }],
				},
			];

			mockApi.getRecords.mockResolvedValue(mockRecords);

			const provider = new HostingerProvider();
			const records = await provider.getRecords('example.com');

			expect(records).toHaveLength(2);
			expect(records[0]).toEqual({
				name: 'api',
				type: 'A',
				ttl: 300,
				values: ['1.2.3.4'],
			});
			expect(records[1]).toEqual({
				name: 'www',
				type: 'CNAME',
				ttl: 300,
				values: ['example.com'],
			});
		});

		it('should handle records with multiple values', async () => {
			const mockRecords = [
				{
					name: 'mail',
					type: 'MX' as const,
					ttl: 3600,
					records: [
						{ content: '10 mail1.example.com' },
						{ content: '20 mail2.example.com' },
					],
				},
			];

			mockApi.getRecords.mockResolvedValue(mockRecords);

			const provider = new HostingerProvider();
			const records = await provider.getRecords('example.com');

			expect(records).toHaveLength(1);
			expect(records[0]?.values).toEqual([
				'10 mail1.example.com',
				'20 mail2.example.com',
			]);
		});

		it('should cache API client after first call', async () => {
			mockApi.getRecords.mockResolvedValue([]);

			const provider = new HostingerProvider();
			await provider.getRecords('example.com');
			await provider.getRecords('example.com');

			// Token should only be fetched once
			expect(mockGetHostingerToken).toHaveBeenCalledTimes(1);
			// API constructor should only be called once
			expect(HostingerApi).toHaveBeenCalledTimes(1);
		});
	});

	describe('upsertRecords', () => {
		it('should create new records', async () => {
			mockApi.getRecords.mockResolvedValue([]);
			mockApi.upsertRecords.mockResolvedValue(undefined);

			const provider = new HostingerProvider();
			const results = await provider.upsertRecords('example.com', [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
				created: true,
				unchanged: false,
			});

			expect(mockApi.upsertRecords).toHaveBeenCalledWith('example.com', [
				{ name: 'api', type: 'A', ttl: 300, records: [{ content: '1.2.3.4' }] },
			]);
		});

		it('should mark unchanged when record exists with same value', async () => {
			mockApi.getRecords.mockResolvedValue([
				{
					name: 'api',
					type: 'A' as const,
					ttl: 300,
					records: [{ content: '1.2.3.4' }],
				},
			]);

			const provider = new HostingerProvider();
			const results = await provider.upsertRecords('example.com', [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' },
				created: false,
				unchanged: true,
			});

			// Should not call upsertRecords since value is unchanged
			expect(mockApi.upsertRecords).not.toHaveBeenCalled();
		});

		it('should update record when value changes', async () => {
			mockApi.getRecords.mockResolvedValue([
				{
					name: 'api',
					type: 'A' as const,
					ttl: 300,
					records: [{ content: '1.2.3.4' }],
				},
			]);
			mockApi.upsertRecords.mockResolvedValue(undefined);

			const provider = new HostingerProvider();
			const results = await provider.upsertRecords('example.com', [
				{ name: 'api', type: 'A', ttl: 300, value: '5.6.7.8' },
			]);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				record: { name: 'api', type: 'A', ttl: 300, value: '5.6.7.8' },
				created: false,
				unchanged: false,
			});

			expect(mockApi.upsertRecords).toHaveBeenCalledWith('example.com', [
				{ name: 'api', type: 'A', ttl: 300, records: [{ content: '5.6.7.8' }] },
			]);
		});

		it('should handle multiple records', async () => {
			mockApi.getRecords.mockResolvedValue([
				{
					name: 'api',
					type: 'A' as const,
					ttl: 300,
					records: [{ content: '1.2.3.4' }],
				},
			]);
			mockApi.upsertRecords.mockResolvedValue(undefined);

			const provider = new HostingerProvider();
			const results = await provider.upsertRecords('example.com', [
				{ name: 'api', type: 'A', ttl: 300, value: '1.2.3.4' }, // Unchanged
				{ name: 'www', type: 'A', ttl: 300, value: '1.2.3.4' }, // New
			]);

			expect(results).toHaveLength(2);
			expect(results[0]?.unchanged).toBe(true);
			expect(results[1]?.created).toBe(true);
		});
	});
});
