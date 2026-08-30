import type { ConstructManifest } from '@geekmidas/manifest';
import {
	assertDerivations,
	dependentsOf,
	UnknownParent,
} from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { Cache } from '../cache';
import { edgeTo, NotAConstruct } from '../construct-interface';
import { KyselyDatabase } from '../database/kysely';
import { RestApi } from '../rest-api';
import { StaticSite } from '../site';

const api = new RestApi('Api', {
	routes: './src/endpoints/**/*.ts',
	authorizers: ['iam'],
	default: 'none',
});

describe('RestApi', () => {
	it('declares one surface providing its address and both caller-derived keys', () => {
		const [surface] = api.declare();

		expect(surface).toMatchObject({
			kind: 'rest-api',
			id: 'Api',
			routes: ['./src/endpoints/**/*.ts'],
			authorizers: ['iam'],
			defaultAuthorizer: 'none',
			provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
		});
	});

	it('canonicalises its id, so one surface cannot be spelled four ways', () => {
		expect(new RestApi('user-api', { default: 'none' }).id).toBe('UserApi');
	});

	it('leaves endpoints to the build when it named a glob', () => {
		// The construct cannot import route modules without evaluating the whole
		// runtime graph to answer "what paths exist".
		const [surface] = api.declare();

		expect(surface).toMatchObject({ endpoints: [] });
	});

	it('does not mutate when it calls another surface', () => {
		// Immutable builders: a module exporting both a base and a variant must
		// not have the second silently change the first.
		const withAuth = api.calls([
			{
				id: 'Auth',
				declare: () => [{ kind: 'rest-api', id: 'Auth', endpoints: [] }],
			},
		]);

		// `calls`, not `dependencies` — a surface-level dependency would hand
		// every route on this API whatever the surface named, which is the
		// over-granting least privilege exists to prevent.
		expect(api.declare()[0]).not.toHaveProperty('calls');
		expect(withAuth.declare()[0]).toMatchObject({
			calls: [{ target: 'Auth', kind: 'rest-api' }],
		});
	});
});

describe('StaticSite', () => {
	const site = new StaticSite('Console', { path: 'apps/console' });

	it('declares where it lives and how it is built', () => {
		expect(site.declare()[0]).toMatchObject({
			kind: 'site',
			id: 'Console',
			variant: 'static',
			path: 'apps/console',
			dependencies: [],
			provides: ['CONSOLE_URL'],
		});
	});

	it('turns an edge into the surface’s caller list', () => {
		// The whole point: nobody writes down who may call the API.
		const console = site.dependsOn([api]);

		const manifest = Object.fromEntries(
			[...api.declare(), ...console.declare()].map((d) => [d.id, d]),
		) as ConstructManifest;

		expect(dependentsOf(manifest, 'Api')).toEqual(['Console']);
	});
});

describe('edgeTo', () => {
	it('reads the kind off the construct rather than taking it on trust', () => {
		expect(edgeTo(api)).toEqual({ target: 'Api', kind: 'rest-api' });
	});

	it('refuses something that declares nothing under its own id', () => {
		// A construct's other nodes are things it owns, not things it is — an
		// auth server's signing secret is not the thing you depend on.
		expect(() =>
			edgeTo({
				id: 'Auth',
				declare: () => [{ kind: 'secret', id: 'AuthSecret' }],
			}),
		).toThrow(NotAConstruct);
	});
});

describe('database.cache()', () => {
	const database = new KyselyDatabase('Orders');

	it('names the database it lives in', () => {
		// Which removes a guess: "the declared database" is unambiguous with one
		// and arbitrary with two.
		expect(database.cache().declare()).toEqual([
			{
				kind: 'cache',
				id: 'OrdersCache',
				of: 'Orders',
				provides: ['ORDERS_CACHE_URL'],
			},
		]);
	});

	it('takes a name and a table when the defaults will not do', () => {
		expect(database.cache('Sessions', { table: 'sessions' }).declare()).toEqual(
			[
				{
					kind: 'cache',
					id: 'Sessions',
					of: 'Orders',
					table: 'sessions',
					provides: ['SESSIONS_URL'],
				},
			],
		);
	});

	it('resolves against its parent, or fails the build', () => {
		const manifest = Object.fromEntries(
			[...database.declare(), ...database.cache().declare()].map((d) => [
				d.id,
				d,
			]),
		) as ConstructManifest;

		expect(() => assertDerivations(manifest)).not.toThrow();

		const orphan = Object.fromEntries(
			database
				.cache()
				.declare()
				.map((d) => [d.id, d]),
		) as ConstructManifest;

		expect(() => assertDerivations(orphan)).toThrow(UnknownParent);
	});

	it('leaves a standalone cache underived', () => {
		// `new Cache('Sessions')` says the app caches and leaves where to the
		// deployment. Treating it as a derivation with a missing parent is the
		// trap `isDerived` testing the value rather than the kind avoids.
		const standalone = Object.fromEntries(
			new Cache('Sessions').declare().map((d) => [d.id, d]),
		) as ConstructManifest;

		expect(() => assertDerivations(standalone)).not.toThrow();
	});
});
