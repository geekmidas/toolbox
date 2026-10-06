/**
 * Where `createDokployApi` gets its endpoint and token: the environment first,
 * then what `gkm login` stored, with an explicit endpoint winning over both.
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
import { storeDokployCredentials } from '../../auth/credentials';
import { createDokployApi } from '../dokploy-api';

describe('createDokployApi', () => {
	const seen: string[] = [];
	const server = setupServer(
		http.get('https://:host/api/project.all', ({ request }) => {
			seen.push(
				`${new URL(request.url).host} ${request.headers.get('x-api-key')}`,
			);
			return HttpResponse.json([]);
		}),
	);
	let home: string;

	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());

	beforeEach(() => {
		seen.length = 0;
		home = mkdtempSync(join(tmpdir(), 'gkm-api-home-'));
		vi.stubEnv('HOME', home);
		// The CLI's home under that HOME, not the suite's shared GKM_HOME.
		vi.stubEnv('GKM_HOME', undefined);
		vi.stubEnv('DOKPLOY_API_TOKEN', undefined);
		vi.stubEnv('DOKPLOY_ENDPOINT', undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
	});

	it('uses the environment when it names both a token and an endpoint', async () => {
		await storeDokployCredentials('stored', 'https://stored.test');
		vi.stubEnv('DOKPLOY_API_TOKEN', 'from-env');
		vi.stubEnv('DOKPLOY_ENDPOINT', 'https://env.test');

		await (await createDokployApi())?.listProjects();

		expect(seen).toEqual(['env.test from-env']);
	});

	it('falls back to stored credentials, at an endpoint given over the stored one', async () => {
		await storeDokployCredentials('stored', 'https://stored.test');

		await (await createDokployApi())?.listProjects();
		await (await createDokployApi('https://other.test'))?.listProjects();

		expect(seen).toEqual(['stored.test stored', 'other.test stored']);
	});

	it('is nothing without credentials', async () => {
		vi.stubEnv('DOKPLOY_API_TOKEN', 'from-env');

		await expect(createDokployApi()).resolves.toBeNull();
	});
});
