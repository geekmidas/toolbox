import { describe, expect, it } from 'vitest';
import { stageClouds } from '../clouds';

const workspace = (extra: Record<string, unknown> = {}) =>
	({
		stages: { local: 'development', deployed: ['prod'] },
		deploy: {},
		...extra,
	}) as never;

describe('the clouds a stage needs credentials for', () => {
	it('is none for a stage that keeps nothing in a cloud', () => {
		expect(stageClouds(workspace(), 'prod')).toEqual({
			aws: false,
			google: false,
		});
	});

	it('is AWS when a provider of the stage provisions there', () => {
		expect(
			stageClouds(
				workspace({ deploy: { objects: { prod: { provider: 's3' } } } }),
				'prod',
			),
		).toEqual({ aws: true, google: false });
	});

	it.for([
		[
			'its mobile apps are set up on Google Play',
			{ mobile: { prod: { provider: 'google-play', developer: '5551234567' } } },
		],
		["the stage's maps are made there", { maps: { prod: { provider: 'google' } } }],
	] as const)('is Google when %s', ([, deploy]) => {
		expect(
			stageClouds(
				workspace({ deploy }),
				'prod',
			),
		).toEqual({ aws: false, google: true });
	});

	it('is AWS when the secrets or the deploy state are kept there', () => {
		const clouds = [
			workspace({
				secrets: { store: { provider: 'ssm', region: 'eu-west-1' } },
			}),
			workspace({ state: { provider: 'ssm', region: 'eu-west-1' } }),
			workspace({ state: { provider: 's3', region: 'eu-west-1' } }),
		].map((w) => stageClouds(w, 'prod').aws);

		expect(clouds).toEqual([true, true, true]);
	});

	it('is none on the local stage, whatever the deployed ones use', () => {
		expect(
			stageClouds(
				workspace({
					deploy: { objects: { development: { provider: 's3' } } },
					secrets: { store: { provider: 'ssm', region: 'eu-west-1' } },
				}),
				'development',
			),
		).toEqual({ aws: false, google: false });
	});
});
