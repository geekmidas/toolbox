import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { drawSecret, SECRET_LENGTH } from '../secret';

describe('drawSecret', () => {
	it('draws 43 letters, digits, - and _ by default', () => {
		expect(SECRET_LENGTH).toBe(43);
		expect(drawSecret(randomInt)).toMatch(/^[\w-]{43}$/);
	});

	it('draws the length and symbols it is given', () => {
		const secret = drawSecret(randomInt, { length: 24, symbols: '!@#' });

		expect(secret).toMatch(/^[A-Za-z0-9!@#]{24}$/);
	});

	it('always includes a symbol when there are any', () => {
		// Never picks a symbol on its own: index 0 is always 'A'.
		const neverASymbol = (n: number) => (n === 3 ? 1 : 0);

		expect(drawSecret(neverASymbol, { length: 8, symbols: '!@#' })).toMatch(
			/[!@#]/,
		);
	});

	it('draws letters and digits only when symbols are empty', () => {
		for (let i = 0; i < 50; i++) {
			expect(drawSecret(randomInt, { length: 12, symbols: '' })).toMatch(
				/^[A-Za-z0-9]{12}$/,
			);
		}
	});
});
