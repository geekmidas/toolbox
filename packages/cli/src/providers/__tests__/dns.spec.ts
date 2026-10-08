import { realpathSync } from 'node:fs';
import type { ConstructManifest } from '@geekmidas/manifest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	SERVER_IPV4,
	serveFrom,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { ServerAddressMissing } from '../../compose/dns';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	assertStageServer,
	composeStageHosts,
	provisionStageDns,
} from '../dns';

/**
 * `gkm setup --stage <stage>`'s DNS step on a compose workspace: its stack's
 * hosts, read off the stack a deploy would run, pointed at the server in the
 * stage's secrets through GoDaddy's records API — MSW in its place.
 */

const TOKEN = 'gd-pat';
let zone: Map<string, { data: string; ttl: number }[]>;
let requests: string[];

const server = setupServer(
	http.get(
		'https://api.godaddy.com/v1/domains/:domain/records/:type/:name',
		({ params, request }) => {
			expect(request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
			requests.push(`GET ${params.type} ${params.name}`);
			const { type, name } = params as { type: string; name: string };
			return HttpResponse.json(
				(zone.get(`${type} ${name}`) ?? []).map((r) => ({ type, name, ...r })),
			);
		},
	),
	http.put(
		'https://api.godaddy.com/v1/domains/:domain/records/:type/:name',
		async ({ params, request }) => {
			const { type, name } = params as { type: string; name: string };
			requests.push(`PUT ${type} ${name}`);
			zone.set(
				`${type} ${name}`,
				(await request.json()) as { data: string; ttl: number }[],
			);
			return new HttpResponse(null, { status: 204 });
		},
	),
);

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;
let background: Record<string, string[]>;

beforeAll(async () => {
	server.listen({ onUnhandledRequest: 'error' });
	dir = realpathSync(await createTempDir('gkm-setup-dns-'));
	writeComposeApp(dir, {
		target: 'compose',
		domain: 'shop.example.com',
		dns: { 'example.com': { provider: 'godaddy' } },
	});
	({ workspace, manifest, runnables, background } = await loadComposeApp(dir));
});

afterAll(async () => {
	server.close();
	await cleanupDir(dir);
});

beforeEach(() => {
	zone = new Map();
	requests = [];
});

const provision = async (dryRun = false) => {
	const lines: string[] = [];
	const report = await provisionStageDns({
		workspace,
		stage: 'production',
		manifest,
		runnables,
		background,
		env: { GODADDY_API_TOKEN: TOKEN },
		log: (line) => lines.push(line),
		...(dryRun ? { dryRun: true } : {}),
	});
	return { report, out: lines.join('\n') };
};

describe("gkm setup's DNS step", () => {
	it('refuses a compose stage with a domain and no server address, first', async () => {
		expect(() =>
			assertStageServer(workspace, 'production', { custom: {} } as never),
		).toThrow(ServerAddressMissing);
		const { report, out } = await provision();
		expect(report.mode).toBe('none');
		expect(out).toContain(
			"gkm secrets:set GKM_SERVER_IPV4 '<ip>' --stage production",
		);
		expect(requests).toEqual([]);
	});

	it('reads the hosts off the stack the stage would run: the apex and each app', async () => {
		await expect(
			composeStageHosts({
				workspace,
				stage: 'production',
				manifest,
				runnables,
				background,
			}),
		).resolves.toEqual([
			'api.shop.example.com',
			'auth.shop.example.com',
			'shop.example.com',
		]);
	});

	it('prints the exact records on a dry run, and writes none', async () => {
		await serveFrom(dir);

		const { report, out } = await provision(true);

		expect(
			report.changes.map((c) => `${c.action} ${c.type} ${c.name}`),
		).toEqual(['create A api.shop', 'create A auth.shop', 'create A shop']);
		expect(out).toContain(`🌐 DNS for 'production' → ${SERVER_IPV4}`);
		expect(out).toMatch(
			/\+ api\.shop\.example\.com\s+A\s+203\.0\.113\.10 {2}\(TTL 600\) — would create/,
		);
		expect(requests.filter((r) => r.startsWith('PUT'))).toEqual([]);
	});

	it('creates them, then leaves them alone', async () => {
		await serveFrom(dir);

		await provision();
		expect(requests.filter((r) => r.startsWith('PUT')).sort()).toEqual([
			'PUT A api.shop',
			'PUT A auth.shop',
			'PUT A shop',
		]);
		expect(zone.get('A shop')).toEqual([{ data: SERVER_IPV4, ttl: 600 }]);

		requests = [];
		const again = await provision();
		expect(requests.filter((r) => r.startsWith('PUT'))).toEqual([]);
		expect(again.report.changes.every((c) => c.action === 'unchanged')).toBe(
			true,
		);
	});

	it('updates a record pointing elsewhere, printing old → new', async () => {
		await serveFrom(dir);
		zone.set('A api.shop', [{ data: '198.51.100.7', ttl: 600 }]);

		const { out } = await provision();

		expect(out).toContain(`198.51.100.7 → ${SERVER_IPV4}`);
		expect(zone.get('A api.shop')).toEqual([{ data: SERVER_IPV4, ttl: 600 }]);
	});

	it('leaves a Dokploy workspace alone: Dokploy writes its own records', async () => {
		const other = realpathSync(await createTempDir('gkm-setup-dns-dokploy-'));
		try {
			writeComposeApp(other, {
				dns: { 'example.com': { provider: 'godaddy' } },
			});
			const loaded = await loadComposeApp(other);

			expect(
				assertStageServer(loaded.workspace, 'production', null),
			).toBeUndefined();
			const report = await provisionStageDns({
				workspace: loaded.workspace,
				stage: 'production',
				env: { GODADDY_API_TOKEN: TOKEN },
				log: () => {},
			});
			expect(report.mode).toBe('none');
		} finally {
			await cleanupDir(other);
		}
	});
});
