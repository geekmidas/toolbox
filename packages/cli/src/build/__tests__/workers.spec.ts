import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../../workspace/types';
import { WorkerHasNoApp, WorkerNameTaken, workerUnits } from '../workers';

const ROOT = '/repo';

const backend = (path: string, extra: Partial<NormalizedAppConfig> = {}) =>
	({
		type: 'backend',
		path,
		port: 3000,
		dependencies: [],
		...extra,
	}) as NormalizedAppConfig;

const workspace = (apps: Record<string, NormalizedAppConfig>) =>
	({ name: 'shop', root: ROOT, apps }) as unknown as NormalizedWorkspace;

const manifest = {
	Api: { kind: 'rest-api', id: 'Api', path: 'apps/api', endpoints: [] },
	Billing: {
		kind: 'rest-api',
		id: 'Billing',
		path: 'apps/billing',
		endpoints: [],
	},
	// An auth server: its endpoints are its own declaration.
	Auth: {
		kind: 'rest-api',
		id: 'Auth',
		path: 'apps/auth',
		endpoints: [{ id: 'Handler', method: 'ALL', path: '/api/auth/*' }],
	},
	Jobs: { kind: 'worker', id: 'Jobs' },
	Invoicing: { kind: 'worker', id: 'Invoicing' },
} as unknown as ConstructManifest;

const apps = {
	api: backend('apps/api'),
	auth: backend('apps/auth'),
	billing: backend('apps/billing'),
};

describe('workerUnits', () => {
	it('builds each worker from the app holding the most of its work', () => {
		expect(
			workerUnits(workspace(apps), manifest, {
				Jobs: ['/repo/apps/api/queues/emails.ts'],
				Invoicing: [
					'/repo/apps/api/crons/remind.ts',
					'/repo/apps/billing/queues/invoices.ts',
					'/repo/apps/billing/subscribers/paid.ts',
				],
			}),
		).toEqual([
			{ id: 'Invoicing', name: 'invoicing', app: 'billing' },
			{ id: 'Jobs', name: 'jobs', app: 'api' },
		]);
	});

	it('runs no worker that has no work', () => {
		expect(workerUnits(workspace(apps), manifest, {})).toEqual([]);
	});

	it('builds work outside every app from the first app that generates a server', () => {
		expect(
			workerUnits(workspace(apps), manifest, {
				Jobs: ['/repo/jobs/cleanup.ts'],
			}),
		).toEqual([{ id: 'Jobs', name: 'jobs', app: 'api' }]);
	});

	it('never builds from an app with its own entry, nor from an auth server that holds none of the work', () => {
		const onlyOthers = workspace({
			auth: backend('apps/auth'),
			custom: backend('apps/custom', { entry: './src/main.ts' }),
		});

		expect(() =>
			workerUnits(onlyOthers, manifest, {
				Jobs: ['/repo/apps/custom/queues/emails.ts'],
			}),
		).toThrow(WorkerHasNoApp);
	});

	it('refuses a worker whose service name an app already has', () => {
		expect(() =>
			workerUnits(
				workspace({ ...apps, jobs: backend('apps/jobs') }),
				manifest,
				{ Jobs: ['/repo/apps/api/queues/emails.ts'] },
			),
		).toThrow(WorkerNameTaken);
	});
});
