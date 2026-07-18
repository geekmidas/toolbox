// Type-level checks that the `fromManifest` integrators accept the unified
// `gkm build` manifest shape (`export const manifest = { … } as const`) — both
// the flat and the partitioned `ManifestField` forms. Checked by `ts:check:sst`.

import type { Manifest, ManifestField, RouteInfo } from '@geekmidas/manifest';
import { Api } from '../Api';
import { App } from '../App';
import { Cron } from '../Cron';
import { Function } from '../Function';
import { type GkmLinkable, ResourceType } from '../Linkable';

const stack = new App({
	name: 'a',
	stage: 'dev',
	domain: 'example.com',
	hostedZoneId: 'Z',
	region: 'us-east-1',
}).stack('api');

const db: GkmLinkable = { _id: 'db', _type: ResourceType.Postgres };

// Mirrors a generated `manifest/aws.ts` — one object, `as const`.
const manifest = {
	routes: [
		{
			path: '/users/{id}',
			method: 'GET',
			handler: 'users.handler',
			authorizer: 'none',
			environment: ['DB_HOST'],
			timeout: 30,
			memorySize: 1024,
		},
	],
	functions: [
		{ name: 'worker', handler: 'worker.handler', environment: ['DB_URL'] },
	],
	crons: [
		{ name: 'nightly', handler: 'nightly.handler', schedule: 'rate(1 day)' },
	],
} as const satisfies Manifest;

// Each integrator takes the manifest *field*.
export const api = Api.fromManifest(stack, 'Api', manifest.routes, {
	links: [db],
	authorizers: { jwt: { issuer: 'https://i', audiences: ['a'] } },
});
export const workers = Function.fromManifest(stack, manifest.functions, {
	links: [db],
});
export const crons = Cron.fromManifest(stack, manifest.crons, { links: [db] });

// The partitioned `ManifestField` form is also accepted.
const partitionedRoutes = {
	admin: [
		{
			path: '/admin',
			method: 'GET',
			handler: 'admin.handler',
			authorizer: 'iam',
		},
	],
	default: [
		{
			path: '/health',
			method: 'GET',
			handler: 'health.handler',
			authorizer: 'none',
		},
	],
} satisfies ManifestField<RouteInfo>;
export const partitionedApi = Api.fromManifest(
	stack,
	'PartApi',
	partitionedRoutes,
	{ links: [db] },
);
