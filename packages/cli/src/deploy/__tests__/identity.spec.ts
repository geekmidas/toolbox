import { describe, expect, it } from 'vitest';
import { validateImageRef } from '../../docker/imageRef';
import {
	applicationName,
	DeployNamespaceInvalid,
	DeployProjectNameInvalid,
	deployIdentity,
	imageRef,
	isOwnedBy,
	ownershipMarker,
	projectName,
} from '../identity';

const identity = (name: string, namespace?: string, stage = 'production') =>
	deployIdentity({ name, deploy: namespace ? { namespace } : {} }, stage);

describe('deployIdentity', () => {
	it('is in the kebab-cased workspace name by default, and adds nothing to names', () => {
		const shop = identity('shop');

		expect(shop).toEqual({
			namespace: 'shop',
			project: 'shop',
			stage: 'production',
			key: 'shop/shop',
			scope: 'shop',
		});
		expect(projectName(shop)).toBe('shop');
	});

	it('keeps the names a workspace was deployed under before identities', () => {
		// The prefix used to be `${stage}-${name}`.toLowerCase(); a Postgres is
		// found by that name, so a different one would be an empty database.
		const legacy = identity('KitchenSink');

		expect(legacy.namespace).toBe('kitchen-sink');
		expect(legacy.project).toBe('kitchensink');
		expect(legacy.scope).toBe('kitchensink');
		expect(applicationName(legacy, 'api')).toBe('production-kitchensink-api');
	});

	it('puts a chosen namespace in every name and in the key', () => {
		const acme = identity('shop', 'acme');

		expect(acme.key).toBe('acme/shop');
		expect(projectName(acme)).toBe('acme-shop');
		expect(applicationName(acme, 'api')).toBe('production-acme-shop-api');
		expect(imageRef(acme, 'api', 'ghcr.io/acme', 'v1')).toBe(
			'ghcr.io/acme/acme/shop-api:v1',
		);
	});

	it('tells two workspaces with one name apart by namespace', () => {
		const acme = identity('shop', 'acme');
		const globex = identity('shop', 'globex');

		expect(acme.key).not.toBe(globex.key);
		expect(projectName(acme)).not.toBe(projectName(globex));
		expect(applicationName(acme, 'api')).not.toBe(
			applicationName(globex, 'api'),
		);
		expect(imageRef(acme, 'api', 'ghcr.io/x', 'v1')).not.toBe(
			imageRef(globex, 'api', 'ghcr.io/x', 'v1'),
		);
	});

	it('names images a registry accepts, whatever the workspace is called', () => {
		const scoped = identity('@acme/Shop_Front');

		expect(scoped.project).toBe('acme-shop-front');
		const ref = imageRef(scoped, 'adminApi', 'ghcr.io/acme/', 'v1');
		expect(ref).toBe(
			'ghcr.io/acme/acme-shop-front/acme-shop-front-admin-api:v1',
		);
		expect(validateImageRef(ref)).toBe(ref);
	});

	it('refuses a namespace that cannot be a name', () => {
		expect(() => identity('shop', 'Acme Corp')).toThrow(DeployNamespaceInvalid);
		expect(() => identity('shop', '-acme')).toThrow(DeployNamespaceInvalid);
	});

	it('refuses a workspace name with nothing to name by', () => {
		expect(() => identity('@/')).toThrow(DeployProjectNameInvalid);
	});
});

describe('applicationName', () => {
	it('scopes the application by stage, so two stages cannot collide', () => {
		expect(applicationName(identity('shop'), 'api')).not.toBe(
			applicationName(identity('shop', undefined, 'staging'), 'api'),
		);
	});

	it('names an application the way it names a construct', () => {
		// The application beside `production-shop-database`.
		expect(applicationName(identity('shop'), 'api')).toBe(
			'production-shop-api',
		);
		expect(applicationName(identity('shop'), 'web')).toBe(
			'production-shop-web',
		);
	});

	it('does not repeat a project name the app already is', () => {
		expect(applicationName(identity('shop'), 'shop')).toBe('production-shop');
		expect(applicationName(identity('shop', 'acme'), 'shop')).toBe(
			'production-acme-shop',
		);
	});
});

describe('the ownership marker', () => {
	it('is a whole token in the description, never a prefix of another', () => {
		const shop = identity('shop');

		expect(ownershipMarker(shop)).toBe('gkm:shop/shop');
		expect(isOwnedBy('Deployed by gkm.\ngkm:shop/shop', shop)).toBe(true);
		expect(isOwnedBy('gkm:shop/shop-admin', shop)).toBe(false);
		expect(isOwnedBy('gkm:acme/shop', shop)).toBe(false);
		expect(isOwnedBy(null, shop)).toBe(false);
	});
});
