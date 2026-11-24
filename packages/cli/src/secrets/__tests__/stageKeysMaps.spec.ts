import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { workspaceStageKeys } from '../stageKeys';

/**
 * The Maps keys a stage must be given: one per caller where its provider
 * makes them, and one per role — set by hand, read by every caller — on any
 * other stage.
 */
const edge = { target: 'Maps', kind: 'maps' };
const site = (id: string) => ({
	kind: 'site',
	id,
	variant: 'static',
	app: { path: `apps/${id.toLowerCase()}` },
	dependencies: [edge],
});
const manifest = {
	Maps: {
		kind: 'maps',
		id: 'Maps',
		apis: ['maps'],
		provides: [
			'MAPS_API_KEY',
			'MAPS_BROWSER_KEY',
			'MAPS_ANDROID_KEY',
			'MAPS_IOS_KEY',
		],
	},
	Web: site('Web'),
	Admin: site('Admin'),
} as unknown as ConstructManifest;

const listed = (input: Partial<Parameters<typeof workspaceStageKeys>[0]>) =>
	workspaceStageKeys({ manifest, local: false, supplied: {}, ...input })
		.filter((key) => key.kind === 'maps')
		.map(({ key, apps, set }) => ({ key, apps, set }));

describe('the Maps keys a stage must be given', () => {
	it('lists each caller’s own where the stage’s provider makes them', () => {
		expect(
			listed({
				providers: { maps: { accounted: true, hint: 'gkm deploy makes it' } },
				supplied: { MAPS_BROWSER_KEY_WEB: 'AIza-web' },
			}),
		).toEqual([
			{ key: 'MAPS_BROWSER_KEY_ADMIN', apps: ['admin'], set: false },
			{ key: 'MAPS_BROWSER_KEY_WEB', apps: ['web'], set: true },
		]);
	});

	it.for([
		['a deployed stage set by hand', false],
		['the local stage', true],
	] as const)('lists one per role, read by every caller, on %s', ([
		,
		local,
	]) => {
		expect(listed({ local })).toEqual([
			{ key: 'MAPS_BROWSER_KEY', apps: ['admin', 'web'], set: false },
		]);
	});
});
