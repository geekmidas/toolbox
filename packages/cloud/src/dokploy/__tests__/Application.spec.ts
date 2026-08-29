import { describe, expect, it } from 'vitest';
import { appNameFor, diffApplication } from '../Application';

/**
 * The decisions, without a Dokploy server. Instantiating the resource needs
 * Pulumi and a real endpoint; deciding what a change *costs* does not, which is
 * the half worth asserting — a wrong answer here is a destroy nobody previewed.
 */

const base = {
	name: 'Api',
	projectId: 'proj-1',
	environmentId: 'env-1',
};

describe('appNameFor', () => {
	it('is what Dokploy will actually call it', () => {
		expect(appNameFor('My API')).toBe('my-api');
	});

	it('collapses anything that is not a name character', () => {
		expect(appNameFor('Orders_v2!')).toBe('orders-v2-');
	});
});

describe('diffApplication', () => {
	it('sees no change when nothing changed', () => {
		expect(diffApplication(base, base)).toMatchObject({
			changes: false,
			replaces: [],
		});
	});

	it('replaces on a renamed application, because appName derives from it', () => {
		// Dokploy computes `appName` from the name, so changing it is a different
		// application rather than an edit to this one.
		expect(diffApplication(base, { ...base, name: 'Gateway' })).toMatchObject({
			changes: true,
			replaces: ['name'],
		});
	});

	it('does not replace when only the casing changed', () => {
		// `Api` and `API` are the same `appName`, so there is nothing to destroy —
		// and destroying an application to restyle its name in the UI would be a
		// spectacular way to lose one.
		expect(diffApplication(base, { ...base, name: 'API' })).toMatchObject({
			replaces: [],
			changes: true,
		});
	});

	it('replaces on a move between projects or environments', () => {
		expect(
			diffApplication(base, { ...base, projectId: 'proj-2' }).replaces,
		).toEqual(['projectId']);
		expect(
			diffApplication(base, { ...base, environmentId: 'env-2' }).replaces,
		).toEqual(['environmentId']);
	});

	it('creates the replacement before removing the old one', () => {
		// A Dokploy project can hold both for a moment; it cannot hold a gap
		// where the application used to be.
		expect(
			diffApplication(base, { ...base, name: 'Gateway' }).deleteBeforeReplace,
		).toBe(false);
	});
});
