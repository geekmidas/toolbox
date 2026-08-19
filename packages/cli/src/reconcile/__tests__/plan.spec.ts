import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { containerFor, type PlanOptions, planFor, resourceName } from '../plan';

/** A database, a tenant, a reader on the tenant, a bucket, and mail. */
const manifest = {
	Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
	Auth: {
		kind: 'database-schema',
		id: 'Auth',
		of: 'Orders',
		schema: 'auth',
		provides: ['AUTH_URL'],
	},
	AuthReader: {
		kind: 'database-reader',
		id: 'AuthReader',
		of: 'Auth',
		provides: ['AUTH_READER_URL'],
	},
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
} as const satisfies ConstructManifest;

const plan = (stage: string, options?: PlanOptions) =>
	planFor(manifest, stage, provisionOrder(manifest), options);

describe('resourceName', () => {
	it('leaves the default stage unsuffixed', () => {
		// So a developer's psql history and saved connections survive this change.
		expect(resourceName('Orders', 'database', 'development')).toBe('orders');
	});

	it('suffixes a database with an underscore', () => {
		// A hyphen would need quoting in every Postgres identifier.
		expect(resourceName('Orders', 'database', 'test')).toBe('orders_test');
	});

	it('suffixes a bucket with a hyphen', () => {
		// Underscores are not valid in bucket names on some providers.
		expect(resourceName('Uploads', 'objects', 'test')).toBe('uploads-test');
	});

	it('suffixes derived kinds like their parent', () => {
		expect(resourceName('AuthReader', 'database-reader', 'test')).toBe(
			'authreader_test',
		);
	});

	it('handles stages beyond dev and test', () => {
		expect(resourceName('Orders', 'database', 'preview')).toBe(
			'orders_preview',
		);
	});
});

describe('containerFor', () => {
	it('maps every database kind onto one Postgres', () => {
		// A tenant lives inside its parent's container, not beside it.
		expect(containerFor('database')).toBe('postgres');
		expect(containerFor('database-schema')).toBe('postgres');
		expect(containerFor('database-reader')).toBe('postgres');
	});

	it('maps objects onto minio', () => {
		expect(containerFor('objects')).toBe('minio');
	});

	it('maps email onto mailpit whatever will deliver it deployed', () => {
		// One local container for every provider: the inbox you can actually
		// open, and the provider survives only as a host in the URL.
		expect(containerFor('email')).toBe('mailpit');
	});
});

describe('planFor', () => {
	it('deduplicates containers across constructs of the same kind', () => {
		// Three database constructs, one Postgres.
		expect(plan('development').containers.sort()).toEqual([
			'mailpit',
			'minio',
			'postgres',
		]);
	});

	it('gives mail a container but nothing to provision', () => {
		// Mailpit accepts whatever is sent to it, so there is nothing to create
		// inside it — but it still resolves a URL, so it stays in the plan.
		const { containers, resources } = plan('test');
		const mail = resources.find((r) => r.id === 'Mail');

		expect(containers).toContain('mailpit');
		expect(mail?.provisions).toBe(false);
	});

	it('marks resources that must be created', () => {
		const { resources } = plan('test');

		expect(resources.find((r) => r.id === 'Orders')?.provisions).toBe(true);
		expect(resources.find((r) => r.id === 'Uploads')?.provisions).toBe(true);
	});

	it('carries a tenant’s schema through to the applier', () => {
		expect(plan('test').resources.find((r) => r.id === 'Auth')?.schema).toBe(
			'auth',
		);
	});

	it('keeps parents ahead of the constructs derived from them', () => {
		expect(plan('development').resources.map((r) => r.id)).toEqual([
			'Orders',
			'Auth',
			'AuthReader',
			'Uploads',
			'Mail',
		]);
	});

	it('records the parent of a derived resource', () => {
		const auth = plan('test').resources.find((r) => r.id === 'Auth');

		expect(auth?.of).toBe('Orders');
	});

	it('leaves a resource that provisions itself with no parent', () => {
		const orders = plan('test').resources.find((r) => r.id === 'Orders');

		expect(orders).not.toHaveProperty('of');
	});

	it('names every resource for the stage', () => {
		expect(
			Object.fromEntries(plan('test').resources.map((r) => [r.id, r.name])),
		).toEqual({
			Orders: 'orders_test',
			Auth: 'auth_test',
			AuthReader: 'authreader_test',
			Uploads: 'uploads-test',
			Mail: 'mail-test',
		});
	});

	it('derives the same env keys whatever the stage', () => {
		// Only the value differs between stages; the key an app reads is fixed,
		// which is what lets one construct serve both.
		const keys = (stage: string) => plan(stage).resources.map((r) => r.envKey);

		expect(keys('test')).toEqual(keys('development'));
		expect(keys('test')).toEqual([
			'ORDERS_URL',
			'AUTH_URL',
			'AUTH_READER_URL',
			'UPLOADS_URL',
			'MAIL_URL',
		]);
	});

	it('starts the same containers whatever the stage', () => {
		// The stage names resources; it never names infrastructure.
		expect(plan('test').containers).toEqual(plan('development').containers);
	});

	it('adds a container for an events backend that needs one', () => {
		expect(plan('test', { events: 'sns' }).containers).toContain('localstack');
		expect(plan('test', { events: 'rabbitmq' }).containers).toContain(
			'rabbitmq',
		);
	});

	it('adds no container for pg-boss', () => {
		// It is a schema tenant in a database the manifest already declares, so
		// mapping it to postgres here would start one for a project with none.
		expect(plan('test', { events: 'pgboss' }).containers).toEqual(
			plan('test').containers,
		);
	});

	it('starts no database for pg-boss when nothing declared one', () => {
		expect(planFor({}, 'test', [], { events: 'pgboss' }).containers).toEqual(
			[],
		);
	});

	it('merges in containers no construct implies', () => {
		// What the workspace `services:` block becomes: a list of exceptions.
		expect(plan('test', { extraContainers: ['redis'] }).containers).toContain(
			'redis',
		);
	});

	it('does not duplicate an extra container a construct already implies', () => {
		const { containers } = plan('test', { extraContainers: ['postgres'] });

		expect(containers.filter((c) => c === 'postgres')).toHaveLength(1);
	});

	it('plans nothing for an empty manifest', () => {
		expect(planFor({}, 'test', [])).toEqual({
			stage: 'test',
			containers: [],
			resources: [],
		});
	});

	it('ignores kinds that need no container', () => {
		// A function is not a resource; it appears in the manifest but plans
		// nothing here.
		const withUnknown = planFor(
			{ Orders: { kind: 'database', id: 'Orders' } },
			'test',
			['Orders', 'SomethingElse'],
		);

		expect(withUnknown.resources).toHaveLength(1);
	});
});
