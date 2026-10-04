// Type-level tests for `fromManifest`'s overrides, inferred from the manifest.
// Checked by `ts:check:sst`; each `@ts-expect-error` self-validates: if the
// inference regresses, the now-unused directive becomes a TS error the gate
// catches.

import type { ConstructManifest } from '@geekmidas/manifest';
import { App } from '../App';
import { fromManifest } from '../fromManifest';

const stack = new App({
	name: 'a',
	stage: 'dev',
	domain: 'example.com',
	hostedZoneId: 'Z',
	region: 'us-east-1',
}).stack('shop');

declare const vpc: sst.aws.Vpc;

// The shape `gkm build` emits: `as const satisfies ConstructManifest`.
const constructs = {
	Orders: {
		kind: 'database',
		id: 'Orders',
		engine: 'postgres',
		provides: ['ORDERS_URL'],
	},
	Billing: {
		kind: 'database-schema',
		id: 'Billing',
		of: 'Orders',
		schema: 'billing',
		provides: ['BILLING_URL'],
	},
	Sessions: { kind: 'cache', id: 'Sessions', provides: ['SESSIONS_URL'] },
	Rates: {
		kind: 'cache',
		id: 'Rates',
		of: 'Orders',
		provides: ['RATES_URL'],
	},
	Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL'] },
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [],
		provides: ['API_URL'],
	},
} as const satisfies ConstructManifest;

// Valid: the two the synth cannot guess, plus an optional bucket prop.
export const ok = fromManifest(stack, constructs, {
	Orders: { vpc },
	Mail: { from: 'no-reply@example.com' },
	Uploads: { cors: false },
});

// A database without its VPC.
// @ts-expect-error — `Orders` is a database: `vpc` is required.
fromManifest(stack, constructs, { Mail: { from: 'a@example.com' } });

// Mail without a sender.
fromManifest(stack, constructs, {
	Orders: { vpc },
	// @ts-expect-error — every provider rejects an unverified sender.
	Mail: {},
});

// A misspelt id.
fromManifest(stack, constructs, {
	Orders: { vpc },
	Mail: { from: 'a@example.com' },
	// @ts-expect-error — not a construct in this manifest.
	Ordrs: { vpc },
});

// A prop the kind's component never reads.
fromManifest(stack, constructs, {
	Orders: { vpc },
	Mail: { from: 'a@example.com' },
	// @ts-expect-error — a surface takes API Gateway args, not bucket ones.
	Api: { versioning: true },
});

// What the declaration already decides is not overridable.
fromManifest(stack, constructs, {
	// @ts-expect-error — the schema is the declaration's, not the deploy's.
	Orders: { vpc, schema: 'other' },
	Mail: { from: 'a@example.com' },
});

// A kind with nothing to override takes no key.
fromManifest(stack, constructs, {
	Orders: { vpc },
	Mail: { from: 'a@example.com' },
	// @ts-expect-error — a schema derives from its database.
	Billing: {},
});

// Nor does a cache in a database: same address, one more table.
fromManifest(stack, constructs, {
	Orders: { vpc },
	Mail: { from: 'a@example.com' },
	// @ts-expect-error — `Rates` lives in `Orders`.
	Rates: { region: 'eu-west-1' },
});

// The backend decides too: ElastiCache needs a VPC to live in…
fromManifest(
	stack,
	constructs,
	// @ts-expect-error — `Sessions` on ElastiCache needs `vpc`.
	{ Orders: { vpc }, Mail: { from: 'a@example.com' } },
	{ cache: 'elasticache' },
);
export const elasticache = fromManifest(
	stack,
	constructs,
	{
		Orders: { vpc },
		Sessions: { vpc: { subnets: [], securityGroups: [] } },
		Mail: { from: 'a@example.com' },
	},
	{ cache: 'elasticache' },
);

// …and mail that is not SES is an account somebody created, with its URL.
fromManifest(
	stack,
	constructs,
	{
		Orders: { vpc },
		// @ts-expect-error — Resend's URL is not something a deploy can mint.
		Mail: { from: 'a@example.com' },
	},
	{ email: 'resend' },
);
export const resend = fromManifest(
	stack,
	constructs,
	{
		Orders: { vpc },
		Mail: { from: 'a@example.com', url: 'smtp://resend' },
	},
	{ email: 'resend' },
);

// A manifest whose ids are not known statically keeps the untyped record.
declare const untyped: ConstructManifest;
export const loose = fromManifest(stack, untyped, { Anything: { at: 'all' } });
