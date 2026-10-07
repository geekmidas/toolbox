import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { healthUrl } from '../health';
import {
	readOutputs,
	SST_OUTPUTS_FILE,
	SstOutputsUnreadable,
	surfaceUrls,
} from '../outputs';

describe('surfaceUrls', () => {
	it('finds an app by its id in any casing, with or without a Url suffix', () => {
		expect(
			surfaceUrls(
				{
					Api: 'https://api.example.com',
					AdminApiUrl: 'https://admin.example.com',
					WEB_URL: 'https://web.example.com',
					auth: { url: 'https://auth.example.com' },
				},
				['api', 'admin-api', 'web', 'auth'],
			),
		).toEqual({
			api: 'https://api.example.com',
			'admin-api': 'https://admin.example.com',
			web: 'https://web.example.com',
			auth: 'https://auth.example.com',
		});
	});

	it('ignores what is not an http(s) URL, and apps nothing names', () => {
		expect(
			surfaceUrls(
				{
					api: 'shop-production-api',
					web: 's3://bucket/web',
					list: ['https://api.example.com'],
					count: 3,
				},
				['api', 'web', 'docs'],
			),
		).toEqual({});
		expect(surfaceUrls(null, ['api'])).toEqual({});
	});

	it('prefers an exact name over one with its suffix stripped', () => {
		expect(
			surfaceUrls(
				{ ApiUrl: 'https://one.example.com', Api: 'https://two.example.com' },
				['api', 'api-url'],
			),
		).toEqual({
			api: 'https://two.example.com',
			'api-url': 'https://one.example.com',
		});
	});
});

describe('readOutputs', () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-sst-outputs-'));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('is empty when SST wrote none', async () => {
		await expect(readOutputs(root)).resolves.toEqual({});
	});

	it('names the file it cannot parse', async () => {
		mkdirSync(join(root, '.sst'));
		writeFileSync(join(root, SST_OUTPUTS_FILE), '{"api": ');

		const error = await readOutputs(root).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(SstOutputsUnreadable);
		expect(error).toMatchObject({ path: join(root, SST_OUTPUTS_FILE) });
	});
});

describe('healthUrl', () => {
	it('keeps the path a URL already has', () => {
		expect(healthUrl('https://x.example.com', '/health')).toBe(
			'https://x.example.com/health',
		);
		expect(healthUrl('https://x.example.com/prod/', '/health')).toBe(
			'https://x.example.com/prod/health',
		);
		expect(healthUrl('https://x.example.com/prod', '/')).toBe(
			'https://x.example.com/prod/',
		);
	});
});
