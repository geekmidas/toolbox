import type { ConstructManifest } from '@geekmidas/manifest';
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
} from 'vitest';
import type { ResourceRecord } from '../../../../deploy/StateStore';
import type { NormalizedWorkspace } from '../../../../workspace/types';
import type {
	EnsureContext,
	ProvisionAction,
	StateEntry,
} from '../../../types';
import { GoogleApiError } from '../../client';
import { GoogleProjectChanged, GoogleProjectNotCreated } from '../../project';
import type { GoogleCredential } from '../../provisioning';
import {
	checkGoogleMapsConfig,
	type GoogleMapsConfig,
	GoogleMapsConfigInvalid,
} from '../config';
import {
	createGoogleMapsProvider,
	type KeyRestrictions,
	keyEntryKey,
	MapsBillingDisabled,
	MapsNotProvisioned,
	MapsRotationInProgress,
	MapsServerKeyCallsNothing,
	MapsSiteHasNoHost,
} from '../index';

/**
 * The google provider for `Maps`, against a fake of the Google APIs it calls
 * — Resource Manager, Service Usage, Cloud Billing and API Keys — served
 * through MSW, so every request is the one a deploy sends.
 */

const PROJECT = 'shop-production';
const STAGE = 'production';
const SHA1 = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01';

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
	billing: true,
	keys: new Map<string, FakeKey>(),
	created: 0,
};

const KEYS_BASE = 'https://apikeys.googleapis.com/v2';
const keyPath = `${KEYS_BASE}/projects/:project/locations/global/keys/:id`;

const server = setupServer(
	http.get(
		'https://cloudresourcemanager.googleapis.com/v3/projects/:project',
		({ params }) =>
			google.projects.has(params.project as string)
				? HttpResponse.json({ projectId: params.project })
				: HttpResponse.json(
						{ error: { message: 'not found' } },
						{ status: 404 },
					),
	),
	http.post(
		'https://cloudresourcemanager.googleapis.com/v3/projects',
		async ({ request }) => {
			const body = (await request.json()) as { projectId: string };
			google.projects.add(body.projectId);
			return HttpResponse.json({ name: 'operations/cp', done: true });
		},
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
		() => HttpResponse.json({ billingEnabled: google.billing }),
	),
	http.post(
		`${KEYS_BASE}/projects/:project/locations/global/keys`,
		async ({ request, params }) => {
			const id = new URL(request.url).searchParams.get('keyId')!;
			const body = (await request.json()) as {
				displayName: string;
				restrictions: KeyRestrictions;
			};
			const name = `projects/${params.project}/locations/global/keys/${id}`;
			const key = { name, ...body, keyString: `AIza-${id}` };
			google.keys.set(name, key);
			google.created++;
			return HttpResponse.json({
				name: `operations/create-${id}`,
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
	http.patch(keyPath, async ({ request, params }) => {
		const key = google.keys.get(nameOf(params));
		if (!key) return HttpResponse.json({}, { status: 404 });
		const body = (await request.json()) as { restrictions: KeyRestrictions };
		key.restrictions = body.restrictions;
		return HttpResponse.json({ name: 'operations/patch', done: true });
	}),
	http.delete(keyPath, ({ params }) => {
		google.keys.delete(nameOf(params));
		return HttpResponse.json({ name: 'operations/delete', done: true });
	}),
);

function nameOf(params: Record<string, unknown>): string {
	return `projects/${params.project}/locations/global/keys/${params.id}`;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

beforeEach(() => {
	google.projects = new Set([PROJECT]);
	google.enabled = new Set();
	google.billing = true;
	google.keys = new Map();
	google.created = 0;
});

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

const MAPS = {
	kind: 'maps',
	id: 'Maps',
	apis: ['maps', 'places'],
	provides: [
		'MAPS_API_KEY',
		'MAPS_BROWSER_KEY',
		'MAPS_ANDROID_KEY',
		'MAPS_IOS_KEY',
	],
};
const edge = { target: 'Maps', kind: 'maps' };

/** A server function, a site and a mobile app that all call Maps. */
const everyCaller = {
	Maps: MAPS,
	Geocode: {
		kind: 'function',
		id: 'Geocode',
		handler: 'src/geocode.ts#handler',
		dependencies: [edge],
	},
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'static',
		app: { path: 'apps/web' },
		dependencies: [edge],
	},
	App: {
		kind: 'mobile-app',
		id: 'App',
		variant: 'expo',
		app: { path: 'apps/app' },
		android: { package: 'com.shop.app' },
		ios: { bundleIdentifier: 'com.shop.app' },
		dependencies: [edge],
	},
} as unknown as ConstructManifest;

const workspace = (domain: string | undefined) =>
	({
		name: 'shop',
		root: '/work/shop',
		domains: domain ? { [STAGE]: domain } : {},
		apps: {
			web: { type: 'web', domain: domain ? { [STAGE]: domain } : undefined },
			admin: {
				type: 'web',
				domain: domain ? { [STAGE]: `admin.${domain}` } : undefined,
			},
		},
	}) as unknown as NormalizedWorkspace;

interface Run {
	ctx: EnsureContext<GoogleMapsConfig, GoogleCredential>;
	secrets: Record<string, string>;
	records: Map<string, ResourceRecord>;
	actions: ProvisionAction[];
	lines: string[];
}

/** One deploy's provider run, carrying the stage's secrets and state over. */
function stage(options: {
	manifest?: ConstructManifest;
	config?: Partial<GoogleMapsConfig>;
	flag?: string;
	domain?: string | undefined;
	secrets?: Record<string, string>;
	records?: Map<string, ResourceRecord>;
	lastDeployedAt?: string;
	rotateKeys?: boolean;
	retireOldKeys?: boolean;
	dryRun?: boolean;
	/** Where the credential comes from: `file` is CI's. */
	source?: 'file' | 'gcloud';
}): Run {
	const secrets = { ...(options.secrets ?? {}) };
	const records = options.records ?? new Map<string, ResourceRecord>();
	const actions: ProvisionAction[] = [];
	const lines: string[] = [];
	const put = (entry: StateEntry, status: string, id?: string) => {
		records.set(entry.key, {
			type: entry.type,
			status,
			...(id ? { id } : {}),
			...(entry.data ? { data: entry.data } : {}),
		} as unknown as ResourceRecord);
	};
	const ctx = {
		workspace: workspace('domain' in options ? options.domain : 'shop.example'),
		manifest: options.manifest ?? everyCaller,
		stage: STAGE,
		identity: { scope: 'shop' },
		config: { provider: 'google', ...options.config },
		credential: {
			signIn: { token: async () => 'token' },
			source: options.source ?? 'gcloud',
			interactive: false,
			...(options.flag ? { project: options.flag } : {}),
		},
		secrets,
		state: {
			record: (key: string) => records.get(key),
			pending: async (entry: StateEntry) => put(entry, 'pending'),
			ready: async (entry: StateEntry, id: string) => put(entry, 'ready', id),
			...(options.lastDeployedAt
				? { lastDeployedAt: options.lastDeployedAt }
				: {}),
		},
		dryRun: options.dryRun ?? false,
		rotateKeys: options.rotateKeys ?? false,
		retireOldKeys: options.retireOldKeys ?? false,
		change: async (action: ProvisionAction, apply: () => Promise<void>) => {
			actions.push(action);
			if (!options.dryRun) await apply();
		},
		writeSecrets: async (values: Record<string, string>) => {
			Object.assign(secrets, values);
		},
		writeDns: async () => ({ manual: [] }),
		log: (line: string) => lines.push(line),
	} as unknown as EnsureContext<GoogleMapsConfig, GoogleCredential>;
	return { ctx, secrets, records, actions, lines };
}

let clock = 1_800_000_000_000;
const provider = createGoogleMapsProvider({
	now: () => clock++,
	intervalMs: 0,
});

const keyFor = (secret: string) =>
	[...google.keys.values()].find((key) => key.keyString === secret);

// ---------------------------------------------------------------------------

describe('the google provider for maps', () => {
	it('makes one key per kind of caller and writes each into the secrets', async () => {
		const run = stage({ config: { android: { sha1: [SHA1] } } });

		await provider.ensure(run.ctx);

		expect(Object.keys(run.secrets).sort()).toEqual([
			'MAPS_ANDROID_KEY',
			'MAPS_API_KEY',
			'MAPS_BROWSER_KEY',
			'MAPS_IOS_KEY',
		]);
	});

	it("restricts the server's key to the web services it can call", async () => {
		const run = stage({});

		await provider.ensure(run.ctx);

		expect(keyFor(run.secrets.MAPS_API_KEY!)?.restrictions).toEqual({
			apiTargets: [
				{ service: 'places-backend.googleapis.com' },
				{ service: 'places.googleapis.com' },
			],
		});
	});

	it("restricts the browser key to the calling sites' hosts", async () => {
		const run = stage({});

		await provider.ensure(run.ctx);

		expect(
			keyFor(run.secrets.MAPS_BROWSER_KEY!)?.restrictions
				.browserKeyRestrictions,
		).toEqual({ allowedReferrers: ['https://shop.example/*'] });
	});

	it("restricts the Android key to the app's package and certificates", async () => {
		const run = stage({ config: { android: { sha1: [SHA1] } } });

		await provider.ensure(run.ctx);

		expect(keyFor(run.secrets.MAPS_ANDROID_KEY!)?.restrictions).toEqual({
			apiTargets: [
				{ service: 'maps-android-backend.googleapis.com' },
				{ service: 'places-backend.googleapis.com' },
				{ service: 'places.googleapis.com' },
			],
			androidKeyRestrictions: {
				allowedApplications: [
					{ packageName: 'com.shop.app', sha1Fingerprint: SHA1 },
				],
			},
		});
	});

	it("restricts the iOS key to the app's bundle id", async () => {
		const run = stage({});

		await provider.ensure(run.ctx);

		expect(
			keyFor(run.secrets.MAPS_IOS_KEY!)?.restrictions.iosKeyRestrictions,
		).toEqual({ allowedBundleIds: ['com.shop.app'] });
	});

	it('says so when the Android key has no certificate to be restricted to', async () => {
		const run = stage({});

		await provider.ensure(run.ctx);

		expect(run.lines.join('\n')).toContain(
			`no deploy.maps.${STAGE}.android.sha1`,
		);
	});

	it('turns on the APIs the keys call, and the ones the provider uses', async () => {
		const run = stage({});

		await provider.ensure(run.ctx);

		expect([...google.enabled].sort()).toEqual([
			'apikeys.googleapis.com',
			'cloudbilling.googleapis.com',
			'maps-android-backend.googleapis.com',
			'maps-backend.googleapis.com',
			'maps-ios-backend.googleapis.com',
			'places-backend.googleapis.com',
			'places.googleapis.com',
		]);
	});

	it('records the project it made the keys in', async () => {
		const run = stage({});

		await provider.ensure(run.ctx);

		expect(run.records.get('google-project:maps')?.id).toBe(PROJECT);
	});

	it('creates the project when it is not there', async () => {
		google.projects = new Set();
		const run = stage({});

		await provider.ensure(run.ctx);

		expect(google.projects.has(PROJECT)).toBe(true);
	});

	it('never creates the project from CI, and says what does', async () => {
		google.projects = new Set();
		const run = stage({ source: 'file' });

		await expect(provider.ensure(run.ctx)).rejects.toThrow(
			GoogleProjectNotCreated,
		);
		expect(google.projects.has(PROJECT)).toBe(false);
	});

	it('works in the project --project names', async () => {
		google.projects.add('acme-maps');
		const run = stage({ flag: 'acme-maps' });

		await provider.ensure(run.ctx);

		expect(run.records.get('google-project:maps')?.id).toBe('acme-maps');
	});

	it('refuses a project other than the one the stage recorded', async () => {
		const first = stage({});
		await provider.ensure(first.ctx);
		google.projects.add('acme-maps');
		const second = stage({ flag: 'acme-maps', records: first.records });

		await expect(provider.ensure(second.ctx)).rejects.toBeInstanceOf(
			GoogleProjectChanged,
		);
	});

	it('stops when the project has no billing linked, and makes no key', async () => {
		google.billing = false;
		const run = stage({});

		await expect(provider.ensure(run.ctx)).rejects.toBeInstanceOf(
			MapsBillingDisabled,
		);
		expect(google.created).toBe(0);
	});

	it('makes nothing a second time', async () => {
		const first = stage({});
		await provider.ensure(first.ctx);
		const second = stage({ secrets: first.secrets, records: first.records });

		await provider.ensure(second.ctx);

		expect(second.actions).toEqual([]);
	});

	it('allows a site that starts calling Maps, without a new key', async () => {
		const first = stage({});
		await provider.ensure(first.ctx);
		const withAdmin = {
			...everyCaller,
			Admin: {
				kind: 'site',
				id: 'Admin',
				variant: 'static',
				app: { path: 'apps/admin' },
				dependencies: [edge],
			},
		} as unknown as ConstructManifest;
		const second = stage({
			manifest: withAdmin,
			secrets: first.secrets,
			records: first.records,
		});

		await provider.ensure(second.ctx);

		expect(
			keyFor(second.secrets.MAPS_BROWSER_KEY!)?.restrictions
				.browserKeyRestrictions?.allowedReferrers,
		).toEqual(['https://admin.shop.example/*', 'https://shop.example/*']);
		expect(google.created).toBe(4);
	});

	it('uses a key the stage set by hand, and makes none for it', async () => {
		const run = stage({ secrets: { MAPS_API_KEY: 'AIza-by-hand' } });

		await provider.ensure(run.ctx);

		expect(run.secrets.MAPS_API_KEY).toBe('AIza-by-hand');
	});

	it('rotates a key, and keeps the old one until the stage runs the new one', async () => {
		const first = stage({});
		await provider.ensure(first.ctx);
		const before = first.secrets.MAPS_API_KEY!;
		const rotating = stage({
			secrets: first.secrets,
			records: first.records,
			rotateKeys: true,
		});

		await provider.ensure(rotating.ctx);

		expect({
			changed: rotating.secrets.MAPS_API_KEY !== before,
			oldKept: keyFor(before) !== undefined,
		}).toEqual({ changed: true, oldKept: true });
	});

	it('deletes the rotated-out key once the stage deployed after the rotation', async () => {
		const first = stage({});
		await provider.ensure(first.ctx);
		const before = first.secrets.MAPS_API_KEY!;
		await provider.ensure(
			stage({
				secrets: first.secrets,
				records: first.records,
				rotateKeys: true,
			}).ctx,
		);
		const after = stage({
			secrets: first.secrets,
			records: first.records,
			lastDeployedAt: '2100-01-01T00:00:00.000Z',
		});

		await provider.ensure(after.ctx);

		expect(keyFor(before)).toBeUndefined();
	});

	it('makes nothing in a dry run', async () => {
		const run = stage({ dryRun: true });

		await provider.ensure(run.ctx);

		expect({ created: google.created, secrets: run.secrets }).toEqual({
			created: 0,
			secrets: {},
		});
	});

	it('refuses a server caller when the only API is the map itself', async () => {
		const manifest = {
			Maps: { ...MAPS, apis: ['maps'] },
			Geocode: everyCaller.Geocode,
		} as unknown as ConstructManifest;
		const run = stage({ manifest });

		await expect(provider.ensure(run.ctx)).rejects.toBeInstanceOf(
			MapsServerKeyCallsNothing,
		);
	});

	it('refuses a browser key with no host to restrict it to', async () => {
		const run = stage({ domain: undefined });

		await expect(provider.ensure(run.ctx)).rejects.toBeInstanceOf(
			MapsSiteHasNoHost,
		);
	});

	it('does nothing for a Maps nothing calls', async () => {
		const run = stage({
			manifest: { Maps: MAPS } as unknown as ConstructManifest,
		});

		await provider.ensure(run.ctx);

		expect(run.actions).toEqual([]);
	});

	it('lists the keys a deploy writes', () => {
		expect(provider.runtimeKeys(everyCaller)).toEqual([
			'MAPS_ANDROID_KEY',
			'MAPS_API_KEY',
			'MAPS_BROWSER_KEY',
			'MAPS_IOS_KEY',
		]);
	});
});

/** Only a server function calls Maps: one key, the server's. */
const serverOnly = {
	Maps: MAPS,
	Geocode: everyCaller.Geocode,
} as unknown as ConstructManifest;

const OPERATIONS = `${KEYS_BASE}/operations/:id`;

describe('a key across deploys', () => {
	it('makes a new key when the secrets no longer hold the recorded one', async () => {
		const first = stage({ manifest: serverOnly });
		await provider.ensure(first.ctx);
		const second = stage({
			manifest: serverOnly,
			secrets: { MAPS_API_KEY: 'AIza-overwritten' },
			records: first.records,
		});

		await provider.ensure(second.ctx);

		expect({
			change: second.actions.at(-1)?.change,
			replaced: second.secrets.MAPS_API_KEY !== 'AIza-overwritten',
			created: google.created,
		}).toEqual({
			change:
				'make a new server key (the secrets no longer hold the recorded one)',
			replaced: true,
			created: 2,
		});
	});

	it('makes the key again when Google no longer has it', async () => {
		const first = stage({ manifest: serverOnly });
		await provider.ensure(first.ctx);
		google.keys.clear();
		const second = stage({
			manifest: serverOnly,
			secrets: first.secrets,
			records: first.records,
		});

		await provider.ensure(second.ctx);

		expect({
			change: second.actions.at(-1)?.change,
			held: keyFor(second.secrets.MAPS_API_KEY!) !== undefined,
		}).toEqual({ change: 'create the server key', held: true });
	});

	it('refuses another rotation while the last one keeps its old key', async () => {
		const first = stage({ manifest: serverOnly });
		await provider.ensure(first.ctx);
		const carry = { secrets: first.secrets, records: first.records };
		await provider.ensure(
			stage({ manifest: serverOnly, ...carry, rotateKeys: true }).ctx,
		);

		await expect(
			provider.ensure(
				stage({ manifest: serverOnly, ...carry, rotateKeys: true }).ctx,
			),
		).rejects.toBeInstanceOf(MapsRotationInProgress);
	});

	it('deletes the rotated-out key at once with --retire-old-keys', async () => {
		const first = stage({ manifest: serverOnly });
		await provider.ensure(first.ctx);
		const before = first.secrets.MAPS_API_KEY!;
		const carry = { secrets: first.secrets, records: first.records };
		await provider.ensure(
			stage({ manifest: serverOnly, ...carry, rotateKeys: true }).ctx,
		);
		const retiring = stage({
			manifest: serverOnly,
			...carry,
			retireOldKeys: true,
		});

		await provider.ensure(retiring.ctx);

		expect({
			gone: keyFor(before) === undefined,
			change: retiring.actions[0]?.change,
		}).toEqual({ gone: true, change: 'delete the rotated-out server key' });
	});

	it('takes a rotated-out key someone already deleted as deleted', async () => {
		const first = stage({ manifest: serverOnly });
		await provider.ensure(first.ctx);
		const carry = { secrets: first.secrets, records: first.records };
		await provider.ensure(
			stage({ manifest: serverOnly, ...carry, rotateKeys: true }).ctx,
		);
		server.use(
			http.delete(keyPath, () =>
				HttpResponse.json({ error: { message: 'gone' } }, { status: 404 }),
			),
		);

		await expect(
			provider.ensure(
				stage({ manifest: serverOnly, ...carry, retireOldKeys: true }).ctx,
			),
		).resolves.toBeUndefined();
	});

	it('waits for a deletion Google has not finished', async () => {
		const first = stage({ manifest: serverOnly });
		await provider.ensure(first.ctx);
		const before = first.secrets.MAPS_API_KEY!;
		const carry = { secrets: first.secrets, records: first.records };
		await provider.ensure(
			stage({ manifest: serverOnly, ...carry, rotateKeys: true }).ctx,
		);
		let polled = 0;
		server.use(
			http.delete(keyPath, ({ params }) => {
				google.keys.delete(nameOf(params));
				return HttpResponse.json({ name: 'operations/del', done: false });
			}),
			http.get(OPERATIONS, () => {
				polled++;
				return HttpResponse.json({ name: 'operations/del', done: true });
			}),
		);

		await provider.ensure(
			stage({ manifest: serverOnly, ...carry, retireOldKeys: true }).ctx,
		);

		expect({ polled, gone: keyFor(before) === undefined }).toEqual({
			polled: 1,
			gone: true,
		});
	});

	it('passes on a refusal to read a recorded key', async () => {
		const first = stage({ manifest: serverOnly });
		await provider.ensure(first.ctx);
		server.use(
			http.get(keyPath, () =>
				HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
			),
		);

		await expect(
			provider.ensure(
				stage({
					manifest: serverOnly,
					secrets: first.secrets,
					records: first.records,
				}).ctx,
			),
		).rejects.toMatchObject({ name: 'GoogleApiError', status: 500 });
	});
});

describe('operations Google has not finished', () => {
	it('waits for a key Google is still making', async () => {
		let polled = 0;
		server.use(
			http.post(
				`${KEYS_BASE}/projects/:project/locations/global/keys`,
				async ({ request, params }) => {
					const id = new URL(request.url).searchParams.get('keyId')!;
					const body = (await request.json()) as {
						displayName: string;
						restrictions: KeyRestrictions;
					};
					const name = `projects/${params.project}/locations/global/keys/${id}`;
					google.keys.set(name, { name, ...body, keyString: `AIza-${id}` });
					return HttpResponse.json({ name: `operations/${id}`, done: false });
				},
			),
			http.get(OPERATIONS, ({ params }) => {
				polled++;
				const key = [...google.keys.values()].find((k) =>
					k.name.endsWith(`/${params.id}`),
				);
				return HttpResponse.json({
					name: `operations/${params.id}`,
					done: polled > 1,
					response: key,
				});
			}),
		);
		const run = stage({ manifest: serverOnly });

		await provider.ensure(run.ctx);

		expect({
			polled,
			held: keyFor(run.secrets.MAPS_API_KEY!) !== undefined,
		}).toEqual({ polled: 2, held: true });
	});

	it('stops, writing nothing, when Google fails to make a key', async () => {
		server.use(
			http.post(`${KEYS_BASE}/projects/:project/locations/global/keys`, () =>
				HttpResponse.json({
					name: 'operations/failed',
					done: true,
					error: { message: 'Quota exceeded for API keys' },
				}),
			),
		);
		const run = stage({ manifest: serverOnly });

		const failed = provider.ensure(run.ctx);

		await expect(failed).rejects.toBeInstanceOf(GoogleApiError);
		await expect(failed).rejects.toMatchObject({
			detail: 'Quota exceeded for API keys',
		});
		expect(run.secrets).toEqual({});
	});

	it('gives up on a key that is never made', async () => {
		server.use(
			http.post(`${KEYS_BASE}/projects/:project/locations/global/keys`, () =>
				HttpResponse.json({ name: 'operations/stuck', done: false }),
			),
			http.get(OPERATIONS, () =>
				HttpResponse.json({ name: 'operations/stuck', done: false }),
			),
		);

		await expect(
			provider.ensure(stage({ manifest: serverOnly }).ctx),
		).rejects.toMatchObject({ detail: 'the operation did not finish' });
	});

	it('waits for new restrictions Google has not applied', async () => {
		const first = stage({});
		await provider.ensure(first.ctx);
		let polled = 0;
		server.use(
			http.patch(keyPath, async ({ request, params }) => {
				const key = google.keys.get(nameOf(params))!;
				key.restrictions = (
					(await request.json()) as { restrictions: KeyRestrictions }
				).restrictions;
				return HttpResponse.json({ name: 'operations/patch', done: false });
			}),
			http.get(OPERATIONS, () => {
				polled++;
				return HttpResponse.json({ name: 'operations/patch', done: true });
			}),
		);
		const withAdmin = {
			...everyCaller,
			Admin: {
				kind: 'site',
				id: 'Admin',
				variant: 'static',
				app: { path: 'apps/admin' },
				dependencies: [edge],
			},
		} as unknown as ConstructManifest;

		await provider.ensure(
			stage({
				manifest: withAdmin,
				secrets: first.secrets,
				records: first.records,
			}).ctx,
		);

		expect(polled).toBe(1);
	});

	it('waits for APIs Google is still turning on', async () => {
		let polled = 0;
		server.use(
			http.post(
				/serviceusage\.googleapis\.com\/v1\/projects\/[^/]+\/services:batchEnable$/,
				async ({ request }) => {
					const body = (await request.json()) as { serviceIds: string[] };
					for (const id of body.serviceIds) google.enabled.add(id);
					return HttpResponse.json({ name: 'operations/acf', done: false });
				},
			),
			http.get('https://serviceusage.googleapis.com/v1/operations/acf', () => {
				polled++;
				return HttpResponse.json({ name: 'operations/acf', done: true });
			}),
		);
		const run = stage({ manifest: serverOnly });

		await provider.ensure(run.ctx);

		expect({ polled, keys: Object.keys(run.secrets) }).toEqual({
			polled: 1,
			keys: ['MAPS_API_KEY'],
		});
	});
});

describe('the project and its APIs', () => {
	it('reads every page of the enabled APIs before turning any on', async () => {
		const first = stage({ manifest: serverOnly });
		await provider.ensure(first.ctx);
		const [firstHalf, ...rest] = [...google.enabled];
		server.use(
			http.get(
				'https://serviceusage.googleapis.com/v1/projects/:project/services',
				({ request }) => {
					const page = new URL(request.url).searchParams.get('pageToken');
					return HttpResponse.json(
						page === 'next page'
							? { services: rest.map((name) => ({ config: { name } })) }
							: {
									services: [
										{ config: { name: firstHalf } },
										{ config: {} },
										{ config: { name: 'unrelated.googleapis.com' } },
									],
									nextPageToken: 'next page',
								},
					);
				},
			),
		);
		const second = stage({
			manifest: serverOnly,
			secrets: first.secrets,
			records: first.records,
		});

		await provider.ensure(second.ctx);

		expect(second.actions).toEqual([]);
	});

	it('in a dry run, stops at the project it would create', async () => {
		google.projects.clear();
		const run = stage({ manifest: serverOnly, dryRun: true });

		await provider.ensure(run.ctx);

		expect({
			actions: run.actions.map((a) => a.change),
			created: google.projects.has(PROJECT),
		}).toEqual({ actions: ['create'], created: false });
	});

	it('passes on a refusal to look at the project', async () => {
		server.use(
			http.get(
				'https://cloudresourcemanager.googleapis.com/v3/projects/:project',
				() =>
					HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
			),
		);

		await expect(
			provider.ensure(stage({ manifest: serverOnly }).ctx),
		).rejects.toMatchObject({ name: 'GoogleApiError', status: 500 });
	});
});

describe('a mobile app that declares one platform or neither', () => {
	const manifestWith = (app: Record<string, unknown>) =>
		({
			Maps: MAPS,
			App: {
				kind: 'mobile-app',
				id: 'App',
				variant: 'expo',
				app: { path: 'apps/app' },
				dependencies: [edge],
				...app,
			},
		}) as unknown as ConstructManifest;

	it.for([
		['neither', {}, [], ['no android.package', 'no ios.bundleIdentifier']],
		[
			'only Android',
			{ android: { package: 'com.shop.app' } },
			['MAPS_ANDROID_KEY'],
			['no ios.bundleIdentifier'],
		],
		[
			'only iOS',
			{ ios: { bundleIdentifier: 'com.shop.app' } },
			['MAPS_IOS_KEY'],
			['no android.package'],
		],
	] as const)('%s: a key for each platform it declares, and says which it skipped', async ([
		,
		app,
		keys,
		said,
	]) => {
		const run = stage({
			manifest: manifestWith(app),
			config: { android: { sha1: [SHA1] } },
		});

		await provider.ensure(run.ctx);

		expect({
			keys: Object.keys(run.secrets).sort(),
			said: said.filter((part) =>
				run.lines.some((line) => line.includes(part)),
			),
		}).toEqual({ keys, said });
	});
});

describe("the google provider's check of a stage", () => {
	const verify = (
		secrets: Record<string, string>,
		resources?: Record<string, ResourceRecord>,
	) =>
		provider.verify({
			workspace: workspace('shop.example'),
			manifest: everyCaller,
			stage: STAGE,
			config: { provider: 'google' },
			secrets,
			...(resources ? { resources } : {}),
		});

	it('passes a stage holding every key its callers hold', async () => {
		await expect(
			verify({
				MAPS_API_KEY: 'a',
				MAPS_BROWSER_KEY: 'b',
				MAPS_ANDROID_KEY: 'c',
				MAPS_IOS_KEY: 'd',
			}),
		).resolves.toBeUndefined();
	});

	it('refuses a stage missing a key a caller holds', async () => {
		await expect(verify({ MAPS_API_KEY: 'a' })).rejects.toBeInstanceOf(
			MapsNotProvisioned,
		);
	});

	it("does not ask for a phone's key the deploy made none of", async () => {
		await expect(
			verify(
				{ MAPS_API_KEY: 'a', MAPS_BROWSER_KEY: 'b', MAPS_IOS_KEY: 'd' },
				{
					[keyEntryKey('Maps', 'iosKey')]: {
						type: 'maps-key',
						status: 'ready',
					} as unknown as ResourceRecord,
				},
			),
		).resolves.toBeUndefined();
	});
});

describe('deploy.maps.<stage>', () => {
	it('takes a project and Android signing certificates', () => {
		const config = {
			provider: 'google',
			project: 'acme-maps',
			android: { sha1: [SHA1] },
		};

		expect(checkGoogleMapsConfig(STAGE, config)).toEqual(config);
	});

	it.for([
		['an unknown field', { provider: 'google', region: 'eu' }],
		['a project id Google refuses', { provider: 'google', project: 'Acme' }],
		[
			'a fingerprint that is not SHA-1',
			{ provider: 'google', android: { sha1: ['abc'] } },
		],
	] as const)('refuses %s', ([, config]) => {
		expect(() => checkGoogleMapsConfig(STAGE, config as never)).toThrow(
			GoogleMapsConfigInvalid,
		);
	});
});
