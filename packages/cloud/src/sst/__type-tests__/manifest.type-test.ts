// Type-level checks that the `fromManifest` integrators accept the
// `@geekmidas/manifest` shapes. Checked by `ts:check:sst`; vitest ignores it.

import type {
	CronsManifest,
	FunctionsManifest,
	RoutesManifest,
} from '@geekmidas/manifest';
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

const routesManifest: RoutesManifest = {
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
};
export const api = Api.fromManifest(stack, 'Api', routesManifest, {
	links: [db],
	authorizers: { jwt: { issuer: 'https://i', audiences: ['a'] } },
});

const functionsManifest: FunctionsManifest = {
	functions: [
		{ name: 'worker', handler: 'worker.handler', environment: ['DB_URL'] },
	],
};
export const workers = Function.fromManifest(stack, functionsManifest, {
	links: [db],
});

const cronsManifest: CronsManifest = {
	crons: [
		{ name: 'nightly', handler: 'nightly.handler', schedule: 'rate(1 day)' },
	],
};
export const crons = Cron.fromManifest(stack, cronsManifest, { links: [db] });
