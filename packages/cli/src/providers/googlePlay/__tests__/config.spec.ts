import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../../types';
import { checkGooglePlayConfig, GooglePlayConfigInvalid } from '../config';

const check = (entry: Record<string, unknown>) =>
	checkGooglePlayConfig('production', entry as unknown as ProviderConfig);

describe('deploy.mobile.<stage> for google-play', () => {
	it('takes a developer account and a project', () => {
		expect(
			check({
				provider: 'google-play',
				developer: '123',
				project: 'shop-play',
			}),
		).toEqual({
			provider: 'google-play',
			developer: '123',
			project: 'shop-play',
		});
	});

	it('takes a developer account alone', () => {
		expect(check({ provider: 'google-play', developer: '123' })).toEqual({
			provider: 'google-play',
			developer: '123',
		});
	});

	it.for([
		['a field it does not take', { developer: '123', track: 'beta' }, 'track'],
		['no developer', {}, 'developer'],
		['a developer that is not a number', { developer: 'acme' }, 'developer'],
		['an empty project', { developer: '123', project: '' }, 'project'],
		[
			'a project that is not a string',
			{ developer: '123', project: 7 },
			'project',
		],
	] as const)('refuses %s, naming the field', ([, entry, field]) => {
		let thrown: unknown;
		try {
			check({ provider: 'google-play', ...entry });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(GooglePlayConfigInvalid);
		expect(thrown).toMatchObject({ stage: 'production', field });
	});
});
