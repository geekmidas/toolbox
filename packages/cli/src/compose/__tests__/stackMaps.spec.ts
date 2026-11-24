import { realpathSync } from 'node:fs';
import type { ConstructManifest, Declaration } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { initStageSecrets } from '../../secrets/storage';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	type ComposeStack,
	composeStack,
	type StackInput,
	StageSecretMissing,
} from '../stack';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

/**
 * A `Maps` construct the API, the worker and the site all call, composed:
 * each process is handed a key of its own under the role's name it reads.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let background: Record<string, string[]>;

const edge = { target: 'Maps', kind: 'maps' } as const;

/** The compose app's API, worker and site, each with an edge to Maps. */
function withMaps(base: ConstructManifest): ConstructManifest {
	const calls = (declaration: Declaration | undefined) =>
		({
			...declaration,
			dependencies: [
				...((declaration as { dependencies?: unknown[] })?.dependencies ?? []),
				edge,
			],
		}) as unknown as Declaration;
	return {
		...base,
		Maps: {
			kind: 'maps',
			id: 'Maps',
			apis: ['maps', 'geocoding'],
			provides: [
				'MAPS_API_KEY',
				'MAPS_BROWSER_KEY',
				'MAPS_ANDROID_KEY',
				'MAPS_IOS_KEY',
			],
		} as unknown as Declaration,
		Api: calls(base.Api),
		Jobs: calls(base.Jobs),
		Web: calls(base.Web),
	};
}

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-maps-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	const loaded = await loadComposeApp(dir);
	({ workspace, background } = loaded);
	manifest = withMaps(loaded.manifest);
});

afterAll(async () => {
	await cleanupDir(dir);
});

function stack(
	stage: string,
	custom: Record<string, string>,
	overrides: Partial<StackInput> = {},
): ComposeStack {
	const deployed = stage !== 'development';
	return composeStack({
		workspace,
		manifest,
		background,
		stage,
		identity: deployIdentity(workspace, stage),
		images: deployed
			? { mode: 'pull', tag: 'v1.4.0', registry: 'registry.example.com/acme' }
			: { mode: 'build', tag: 'abc1234' },
		ports: deployed ? {} : { https: 8443, http: 8080 },
		localCredentials: TEST_CREDENTIALS,
		...(deployed
			? {
					secrets: {
						...initStageSecrets(stage),
						seed: 'a-random-seed',
						custom: {
							AUTH_SECRET: 'the-production-signing-secret',
							REDIS_PASSWORD: 'the-redis-password',
							...custom,
						},
					},
				}
			: {
					secrets: { ...initStageSecrets(stage), custom },
				}),
		...overrides,
	});
}

const OWN = {
	MAPS_API_KEY__API: 'api-own',
	MAPS_API_KEY__JOBS: 'jobs-own',
	MAPS_BROWSER_KEY__WEB: 'web-own',
};

describe('a deployed stage', () => {
	it("hands each server process its own key, under the role's name", () => {
		const s = stack('production', OWN);

		expect({
			api: s.apps.find((a) => a.name === 'api')?.env?.MAPS_API_KEY,
			jobs: s.workers.find((w) => w.id === 'Jobs')?.env?.MAPS_API_KEY,
		}).toEqual({ api: 'api-own', jobs: 'jobs-own' });
	});

	it('hands no process another caller’s key, nor its own by the name it is kept under', () => {
		const s = stack('production', OWN);

		const envs = JSON.stringify([
			...s.apps.map((a) => a.env),
			...s.workers.map((w) => w.env),
		]);
		expect({
			kept: envs.includes('__'),
			webs: envs.includes('web-own'),
		}).toEqual({ kept: false, webs: false });
	});

	it("builds the site with its own browser key, under its bundle's name", () => {
		const s = stack('production', OWN, {
			images: {
				mode: 'build',
				tag: 'v1.4.0',
				registry: 'registry.example.com/acme',
			},
		});

		const args = s.apps.find((a) => a.name === 'web')?.build?.args ?? {};
		expect(
			Object.entries(args).filter(([key]) => key.endsWith('MAPS_BROWSER_KEY')),
		).toEqual([[expect.stringMatching(/_MAPS_BROWSER_KEY$/), 'web-own']]);
	});

	it('reads the key set by hand for every caller, where a caller has none of its own', () => {
		const s = stack('production', {
			MAPS_API_KEY: 'shared',
			MAPS_API_KEY__API: 'api-own',
			MAPS_BROWSER_KEY: 'shared-browser',
		});

		expect({
			api: s.apps.find((a) => a.name === 'api')?.env?.MAPS_API_KEY,
			jobs: s.workers.find((w) => w.id === 'Jobs')?.env?.MAPS_API_KEY,
		}).toEqual({ api: 'api-own', jobs: 'shared' });
	});

	it('refuses a caller with no key, naming the one it would be kept under', () => {
		expect(() =>
			stack('production', {
				MAPS_API_KEY__JOBS: 'jobs-own',
				MAPS_BROWSER_KEY__WEB: 'web-own',
			}),
		).toThrow(
			expect.objectContaining({
				constructor: StageSecretMissing,
				message: expect.stringContaining('MAPS_API_KEY__API'),
			}),
		);
	});
});

describe('the local stage', () => {
	it("hands every caller the role's key set by hand", () => {
		const s = stack('development', {
			MAPS_API_KEY: 'by-hand',
			MAPS_BROWSER_KEY: 'by-hand-browser',
		});

		expect({
			api: s.apps.find((a) => a.name === 'api')?.env?.MAPS_API_KEY,
			jobs: s.workers.find((w) => w.id === 'Jobs')?.env?.MAPS_API_KEY,
		}).toEqual({ api: 'by-hand', jobs: 'by-hand' });
	});
});
