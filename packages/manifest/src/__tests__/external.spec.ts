import { describe, expect, it } from 'vitest';
import { externalApiUrl, NoUrlForStage } from '../external';

describe('externalApiUrl', () => {
	it('answers every stage with one URL', () => {
		const polar = { id: 'Polar', url: 'https://www.polaraccesslink.com' };

		expect(externalApiUrl(polar, 'staging')).toBe(
			'https://www.polaraccesslink.com',
		);
		expect(externalApiUrl(polar, 'prod')).toBe(
			'https://www.polaraccesslink.com',
		);
	});

	it('answers by stage, and falls back to the default', () => {
		const payfast = {
			id: 'PayFast',
			url: {
				prod: 'https://www.payfast.co.za',
				default: 'https://sandbox.payfast.co.za',
			},
		};

		expect(externalApiUrl(payfast, 'prod')).toBe('https://www.payfast.co.za');
		expect(externalApiUrl(payfast, 'staging')).toBe(
			'https://sandbox.payfast.co.za',
		);
	});

	it('refuses a stage the record does not name, with no default', () => {
		const payfast = {
			id: 'PayFast',
			url: { prod: 'https://www.payfast.co.za' },
		};

		expect(() => externalApiUrl(payfast, 'staging')).toThrow(NoUrlForStage);
		expect(() => externalApiUrl(payfast, 'staging')).toThrow(
			expect.objectContaining({ id: 'PayFast', stage: 'staging' }),
		);
	});
});
