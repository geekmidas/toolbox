/**
 * `gkm provision`: a stage's providers on their own — the deploy's first
 * step, with nothing built or released — the local stage included, for the
 * kinds it may provision. Run against a workspace on disk and a fake of the
 * Google APIs the Maps provider calls, served through MSW.
 */

import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import type { KeyRestrictions } from '../../providers/google/maps/index';
import { secretsStoreFor } from '../../secrets/store';
import { normalizeWorkspace } from '../../workspace/index';
import type { WorkspaceConfig } from '../../workspace/types';
import { storedCredentials } from '../credentials';
import { type ProvisionEvent, runProvision } from '../provision';
import { provisionCli, provisionedLine } from '../provisionCli';
import { createStateStore, StateLocked } from '../StateStore';

const LOCAL = 'dev';
const PROJECT = 'shop-dev';

interface FakeKey {
	name: string;
	displayName: string;
	restrictions: KeyRestrictions;
	keyString: string;
}

/** What Google holds, as the fake answers it. */
const google = {
	projects: new Set<string>(),
	enabled: new Set<string>(),
	keys: new Map<string, FakeKey>(),
};

const KEYS = 'https://apikeys.googleapis.com/v2';
const keyPath = `${KEYS}/projects/:project/locations/global/keys/:id`;
const nameOf = (params: Record<string, unknown>) =>
	`projects/${params.project}/locations/global/keys/${params.id}`;

const server = setupServer(
	http.post('https://oauth2.googleapis.com/token', () =>
		HttpResponse.json({ access_token: 'ya29.provision' }),
	),
	http.get(
		'https://cloudresourcemanager.googleapis.com/v3/projects/:project',
		({ params }) =>
			google.projects.has(params.project as string)
				? HttpResponse.json({ projectId: params.project })
				: HttpResponse.json({ error: { message: 'nope' } }, { status: 404 }),
	),
	http.get(
		'https://serviceusage.googleapis.com/v1/projects/:project/services',
		() =>
			HttpResponse.json({
				services: [...google.enabled].map((name) => ({ config: { name } })),
			}),
	),
	http.post(
		/serviceusage\.googleapis\.com\/v1\/projects\/[^/]+\/services:batchEnable$/,
		async ({ request }) => {
			const body = (await request.json()) as { serviceIds: string[] };
			for (const id of body.serviceIds) google.enabled.add(id);
			return HttpResponse.json({ name: 'operations/enable', done: true });
		},
	),
	http.get(
		'https://cloudbilling.googleapis.com/v1/projects/:project/billingInfo',
		() => HttpResponse.json({ billingEnabled: true }),
	),
	http.post(
		`${KEYS}/projects/:project/locations/global/keys`,
		async ({ request, params }) => {
			const id = new URL(request.url).searchParams.get('keyId')!;
			const body = (await request.json()) as {
				displayName: string;
				restrictions: KeyRestrictions;
			};
			const name = `projects/${params.project}/locations/global/keys/${id}`;
			const key = { name, ...body, keyString: `AIza-${id}` };
			google.keys.set(name, key);
			return HttpResponse.json({
				name: 'operations/c',
				done: true,
				response: key,
			});
		},
	),
	http.get(`${keyPath}/keyString`, ({ params }) => {
		const key = google.keys.get(nameOf(params));
		return key
			? HttpResponse.json({ keyString: key.keyString })
			: HttpResponse.json({}, { status: 404 });
	}),
	http.get(keyPath, ({ params }) => {
		const key = google.keys.get(nameOf(params));
		return key
			? HttpResponse.json(key)
			: HttpResponse.json({ error: { message: 'gone' } }, { status: 404 });
	}),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/** A server function and a site, both calling Maps. */
const CONSTRUCTS = `
const edge = { target: 'Maps', kind: 'maps' };
export const maps = {
	id: 'Maps',
	declare: () => [{
		kind: 'maps',
		id: 'Maps',
		apis: ['geocoding', 'maps'],
		provides: ['MAPS_API_KEY', 'MAPS_BROWSER_KEY', 'MAPS_ANDROID_KEY', 'MAPS_IOS_KEY'],
	}],
};
export const uploads = {
	id: 'Uploads',
	declare: () => [{
		kind: 'objects',
		id: 'Uploads',
		provides: ['UPLOADS_CONNECTION_STRING'],
	}],
};
export const geocode = {
	id: 'Geocode',
	declare: () => [{
		kind: 'function',
		id: 'Geocode',
		handler: 'src/geocode.ts#handler',
		dependencies: [edge],
	}],
};
export const web = {
	id: 'Web',
	declare: () => [{
		kind: 'site',
		id: 'Web',
		variant: 'static',
		app: { path: 'apps/web' },
		dependencies: [edge],
	}],
};
`;

let root: string;
let home: string;

/** The workspace, with `deploy` as the test gives it. */
const workspaceOf = (deploy: WorkspaceConfig['deploy'] = {}) =>
	normalizeWorkspace(
		{
			name: 'shop',
			stages: { local: LOCAL, deployed: ['production'] },
			constructs: 'constructs/*.ts',
			domains: { production: 'shop.com' },
			apps: {},
			deploy,
		} as WorkspaceConfig,
		root,
	);

const mapsOnLocal = {
	maps: { [LOCAL]: { provider: 'google', project: PROJECT } },
};

/** A run, its events kept. */
async function provision(
	deploy: WorkspaceConfig['deploy'],
	options: {
		stage?: string;
		dryRun?: boolean;
		rotateKeys?: boolean;
		retireOldKeys?: boolean;
		project?: string;
	} = {},
) {
	const events: ProvisionEvent[] = [];
	const { stage = LOCAL, dryRun, ...flags } = options;
	const result = await runProvision(
		() => Promise.resolve(workspaceOf(deploy)),
		{ stage, ...flags },
		{
			emit: (event) => events.push(event),
			credentials: storedCredentials({ home }),
			dryRun: dryRun === true,
			home,
			profile: 'unused-here',
		},
	);
	return { result, events };
}

const secretsOf = async (stage: string) =>
	(await (await secretsStoreFor(workspaceOf(), stage, { home })).read(stage))
		?.custom ?? {};
const localSecrets = () => secretsOf(LOCAL);

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'gkm-provision-'));
	home = mkdtempSync(join(tmpdir(), 'gkm-provision-home-'));
	mkdirSync(join(root, 'constructs'));
	writeFileSync(join(root, 'constructs', 'maps.ts'), CONSTRUCTS);
	const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const key = join(home, 'key.json');
	writeFileSync(
		key,
		JSON.stringify({
			type: 'service_account',
			client_email: 'gkm@shop-dev.iam.gserviceaccount.com',
			private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
		}),
	);
	vi.stubEnv('GKM_HOME', home);
	vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', key);
	google.projects = new Set([PROJECT]);
	google.enabled = new Set();
	google.keys = new Map();
});

afterEach(() => {
	vi.unstubAllEnvs();
	server.resetHandlers();
	rmSync(root, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
});

describe('gkm provision, on the local stage', { timeout: 30_000 }, () => {
	it("creates the local stage's Maps keys and writes them into its secrets", async () => {
		await provision(mapsOnLocal);

		const secrets = await localSecrets();
		expect(Object.keys(secrets).sort()).toEqual([
			'MAPS_API_KEY',
			'MAPS_BROWSER_KEY',
		]);
		expect(google.keys.size).toBe(2);
	});

	it("restricts the browser key to the site's host on the local edge", async () => {
		await provision(mapsOnLocal);

		const browser = [...google.keys.values()].find(
			(key) => key.restrictions.browserKeyRestrictions,
		);
		expect(browser?.restrictions.browserKeyRestrictions).toEqual({
			allowedReferrers: ['https://shop.localhost/*'],
		});
	});

	it('runs the providers and builds and releases nothing', async () => {
		const { events } = await provision(mapsOnLocal);

		const phases = events
			.filter((event) => event.type === 'phase.started')
			.map((event) => (event as { phase: string }).phase);
		expect(phases).toEqual(['validate', 'provision', 'verify']);
	});

	it('records what it made in the local stage’s state, and holds no lock after', async () => {
		await provision(mapsOnLocal);

		const store = await createStateStore({
			config: undefined,
			workspaceRoot: root,
			workspaceName: 'shop',
		});
		const stored = await store.read(LOCAL);
		expect(Object.keys(stored?.resources ?? {}).sort()).toEqual([
			'google-project:maps',
			'maps-key:Maps:browser',
			'maps-key:Maps:server',
		]);
		const lock = await store.lock(LOCAL, { operation: 'test' });
		await lock.release();
	});

	it('makes nothing a second time', async () => {
		await provision(mapsOnLocal);
		const { result } = await provision(mapsOnLocal);

		expect(google.keys.size).toBe(2);
		expect(result.reports.find((r) => r.kind === 'maps')?.actions).toEqual([]);
	});

	it('creates and writes nothing in a dry run, and takes no lock', async () => {
		const store = await createStateStore({
			config: undefined,
			workspaceRoot: root,
			workspaceName: 'shop',
		});
		const held = await store.lock(LOCAL, { operation: 'someone else' });

		const { result } = await provision(mapsOnLocal, { dryRun: true });
		await held.release();

		expect(google.keys.size).toBe(0);
		expect(await localSecrets()).toEqual({});
		expect(result.verified).toEqual([]);
		expect(
			result.reports.find((r) => r.kind === 'maps')?.actions.length,
		).toBeGreaterThan(0);
	});

	it('waits for no one: a second run of the stage is refused while one holds it', async () => {
		const store = await createStateStore({
			config: undefined,
			workspaceRoot: root,
			workspaceName: 'shop',
		});
		const held = await store.lock(LOCAL, { operation: 'deploy' });

		await expect(provision(mapsOnLocal)).rejects.toBeInstanceOf(StateLocked);
		await held.release();
	});

	it('provisions nothing when the local stage names no provider', async () => {
		const { result } = await provision({});

		expect(google.keys.size).toBe(0);
		expect(result.reports.every((r) => r.mode !== 'provider')).toBe(true);
	});

	it('refuses a stage the workspace does not have', async () => {
		await expect(provision(mapsOnLocal, { stage: 'staging' })).rejects.toThrow(
			/staging/,
		);
	});
});

describe('gkm provision, on a deployed stage', { timeout: 30_000 }, () => {
	const mapsOnProduction = {
		maps: { production: { provider: 'google', project: 'shop-prod' } },
	};
	beforeEach(() => {
		google.projects.add('shop-prod');
	});

	it("restricts the browser key to the site's host on the stage's domain", async () => {
		await provision(mapsOnProduction, { stage: 'production' });

		const browser = [...google.keys.values()].find(
			(key) => key.restrictions.browserKeyRestrictions,
		);
		expect(browser?.restrictions.browserKeyRestrictions).toEqual({
			allowedReferrers: ['https://shop.com/*'],
		});
		expect(Object.keys(await secretsOf('production')).sort()).toEqual([
			'MAPS_API_KEY',
			'MAPS_BROWSER_KEY',
		]);
	});

	it('takes the project from --project, and the rotation flags', async () => {
		google.projects.add('shop-other');
		const { result } = await provision(
			{ maps: { production: { provider: 'google' } } },
			{
				stage: 'production',
				project: 'shop-other',
				rotateKeys: true,
				retireOldKeys: true,
			},
		);

		expect(
			[...google.keys.keys()].every((name) => name.includes('shop-other')),
		).toBe(true);
		expect(result.verified).toEqual(['maps: google']);
	});

	it.for([
		['moves', false, { UPLOADS_CONNECTION_STRING: 's3://k:s@uploads' }],
		['leaves, on a dry run,', true, { UPLOADS_URL: 's3://k:s@uploads' }],
	] as const)('%s a bucket key stored under its old name', async ([
		,
		dryRun,
		stored,
	]) => {
		const store = await secretsStoreFor(workspaceOf(), 'production', {
			home,
		});
		const { initStageSecrets } = await import('../../secrets/storage');
		await store.write('production', {
			...initStageSecrets('production'),
			custom: { UPLOADS_URL: 's3://k:s@uploads' },
		});

		await provision({}, { stage: 'production', dryRun });

		expect(await secretsOf('production')).toEqual(stored);
	});

	it('plans nothing on a dry run once the keys exist', async () => {
		await provision(mapsOnProduction, { stage: 'production' });
		const { result } = await provision(mapsOnProduction, {
			stage: 'production',
			dryRun: true,
		});

		expect(result.reports.flatMap((r) => r.planned)).toEqual([]);
	});
});

describe('provisionedLine', () => {
	const report = (actions: number) => ({
		kind: 'maps' as const,
		mode: 'provider' as const,
		provider: 'google',
		actions: Array.from({ length: actions }, () => ({
			construct: 'Maps',
			resource: 'key',
			change: 'create',
		})),
		planned: [],
		dns: [],
	});

	it.for([
		[
			'nothing named',
			{ stage: 'dev', dryRun: false, reports: [], verified: [] },
			"\n✅ 'dev' names no provider: nothing to provision.",
		],
		[
			'one change',
			{ stage: 'dev', dryRun: false, reports: [report(1)], verified: [] },
			"\n✅ 'dev' provisioned (maps: google): 1 change.",
		],
		[
			'a dry run',
			{ stage: 'dev', dryRun: true, reports: [report(2)], verified: [] },
			"\n📋 Dry run of 'dev' (maps: google): 2 changes planned, nothing written.",
		],
	] as const)('says what it did: %s', ([, result, line]) => {
		expect(provisionedLine(result)).toBe(line);
	});
});

describe('gkm provision, the command', { timeout: 60_000 }, () => {
	/** `gkm.config.ts` with no import, so the sandbox needs no packages. */
	const writeConfig = (deploy: object) =>
		writeFileSync(
			join(root, 'gkm.config.ts'),
			`export default ${JSON.stringify({
				name: 'shop',
				stages: { local: LOCAL, deployed: ['production'] },
				constructs: 'constructs/*.ts',
				deploy,
			})};\n`,
		);

	it('writes each event as a JSON line, and exits 0', async () => {
		writeConfig(mapsOnLocal);
		const lines: string[] = [];

		const code = await provisionCli(
			{ cwd: root, stage: LOCAL, json: true },
			{ stdout: { write: (line: string) => lines.push(line) > 0 }, home },
		);

		expect(code).toBe(0);
		const events = lines.map((line) => JSON.parse(line) as ProvisionEvent);
		expect(events.at(-1)?.type).toBe('provision.finished');
		expect(Object.keys(await localSecrets()).sort()).toEqual([
			'MAPS_API_KEY',
			'MAPS_BROWSER_KEY',
		]);
	});

	it('prints progress and the line it ends on at a terminal', async () => {
		writeConfig(mapsOnLocal);
		const printed: string[] = [];
		const log = vi
			.spyOn(console, 'log')
			.mockImplementation((line) => printed.push(String(line)));

		const code = await provisionCli(
			{
				cwd: root,
				stage: LOCAL,
				dryRun: true,
				rotateKeys: true,
				retireOldKeys: true,
				profile: 'shop-dev',
				project: PROJECT,
			},
			{ stdout: { write: () => true }, home },
		);
		log.mockRestore();

		expect(code).toBe(0);
		expect(printed.at(-1)).toMatch(/^\n📋 Dry run of 'dev' \(maps: google\)/);
	});

	it('exits 1, naming the error, when the config refuses the local stage', async () => {
		writeConfig({ objects: { [LOCAL]: { provider: 's3' } } });
		const errors: string[] = [];
		const error = vi
			.spyOn(console, 'error')
			.mockImplementation((line) => errors.push(String(line)));

		const code = await provisionCli(
			{ cwd: root, stage: LOCAL },
			{ stdout: { write: () => true }, home },
		);
		error.mockRestore();

		expect(code).toBe(1);
		expect(errors.join('\n')).toContain('MinIO');
	});
});
