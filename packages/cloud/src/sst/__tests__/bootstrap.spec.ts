import { roleStatements } from '@geekmidas/db/pg/roles';
import { describe, expect, it } from 'vitest';
import { Database } from '../aws/Database';
import { bootstrapEvent, DatabaseBootstrap } from '../aws/DatabaseBootstrap';

const stack = {} as never;
const vpc = { subnets: ['subnet-1'], securityGroups: ['sg-1'] } as never;

const cluster = () => new Database(stack, 'Orders', { vpc });

const bootstrapWith = (
	tenants: { id: string; schema: string; runtime: string; owner: string }[],
) => {
	const bootstrap = new DatabaseBootstrap('Orders', cluster());
	for (const tenant of tenants) bootstrap.add(tenant);

	return bootstrap;
};

describe('DatabaseBootstrap', () => {
	it('does nothing when nothing needs bootstrapping', () => {
		expect(new DatabaseBootstrap('Orders', cluster()).empty).toBe(true);
	});

	it('gives every tenant a secret of its own', () => {
		// A shared secret defeats the thing the role split exists for: a function
		// that could read it could connect as any role.
		const bootstrap = bootstrapWith([
			{
				id: 'AuthDb',
				schema: 'authdb',
				runtime: 'authdb',
				owner: 'authdb_owner',
			},
			{ id: 'Jobs', schema: 'jobs', runtime: 'jobs', owner: 'jobs_owner' },
		]);

		expect([...bootstrap.secrets.keys()].sort()).toEqual(['AuthDb', 'Jobs']);
	});

	it('has no reader credential unless a reader was asked for', () => {
		const bootstrap = bootstrapWith([
			{
				id: 'AuthDb',
				schema: 'authdb',
				runtime: 'authdb',
				owner: 'authdb_owner',
			},
		]);

		expect(bootstrap.readerFor('authdb')).toBeUndefined();
	});

	it('has one when it was', () => {
		const bootstrap = new DatabaseBootstrap('Orders', cluster());
		bootstrap.add({
			id: 'AuthDb',
			schema: 'authdb',
			runtime: 'authdb',
			owner: 'authdb_owner',
			reader: 'authdb_reader',
		});

		expect(bootstrap.readerFor('authdb')?.user).toBe('authdb_reader');
	});
});

describe('bootstrapEvent', () => {
	const master = {
		host: 'db.stub.rds.amazonaws.com',
		port: 5432,
		database: 'orders',
		username: 'postgres',
		password: 'master-pw',
	};

	const tenant = {
		id: 'AuthDb',
		schema: 'authdb',
		runtime: 'authdb',
		owner: 'authdb_owner',
		passwords: { runtime: '', owner: '' },
	};

	const passwords = new Map([
		['authdb', 'runtime-pw'],
		['authdb_owner', 'owner-pw'],
	]);

	it('carries the master credential, which is the only one that exists first', () => {
		const event = JSON.parse(bootstrapEvent(master, [tenant], passwords));

		expect(event.master.username).toBe('postgres');
	});

	it('gives every role a password of its own', () => {
		const event = JSON.parse(bootstrapEvent(master, [tenant], passwords));

		expect(event.tenants[0].passwords).toEqual({
			runtime: 'runtime-pw',
			owner: 'owner-pw',
		});
	});

	it('produces exactly what the handler’s generator accepts', () => {
		// The contract between the two halves. A change to one is a type error in
		// the other, and this asserts the runtime shape agrees too.
		const event = JSON.parse(bootstrapEvent(master, [tenant], passwords));

		expect(roleStatements(event.tenants[0]).length).toBeGreaterThan(0);
	});

	it('carries a reader password only where a reader was named', () => {
		const withReader = { ...tenant, reader: 'authdb_reader' };
		const event = JSON.parse(
			bootstrapEvent(
				master,
				[withReader],
				new Map([...passwords, ['authdb_reader', 'reader-pw']]),
			),
		);

		expect(event.tenants[0].passwords.reader).toBe('reader-pw');
		expect(
			JSON.parse(bootstrapEvent(master, [tenant], passwords)).tenants[0]
				.passwords,
		).not.toHaveProperty('reader');
	});

	it('is stable, so a deploy that changed nothing re-runs nothing', () => {
		// The invocation keys off this input; an unstable one re-applies the DDL
		// on every deploy.
		expect(bootstrapEvent(master, [tenant], passwords)).toBe(
			bootstrapEvent(master, [tenant], passwords),
		);
	});
});
