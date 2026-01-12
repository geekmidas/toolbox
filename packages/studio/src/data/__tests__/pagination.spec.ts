import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../pagination';

describe('encodeCursor', () => {
	it('should encode string values', () => {
		const cursor = encodeCursor('test-value');
		expect(cursor).toBeTruthy();
		expect(typeof cursor).toBe('string');
	});

	it('should encode number values', () => {
		const cursor = encodeCursor(42);
		expect(cursor).toBeTruthy();
	});

	it('should encode Date values', () => {
		const date = new Date('2024-01-15T10:30:00.000Z');
		const cursor = encodeCursor(date);
		expect(cursor).toBeTruthy();
	});

	it('should encode null values', () => {
		const cursor = encodeCursor(null);
		expect(cursor).toBeTruthy();
	});

	it('should encode boolean values', () => {
		const cursor = encodeCursor(true);
		expect(cursor).toBeTruthy();
	});
});

describe('decodeCursor', () => {
	it('should decode string values', () => {
		const original = 'test-value';
		const cursor = encodeCursor(original);
		const decoded = decodeCursor(cursor);
		expect(decoded).toBe(original);
	});

	it('should decode number values', () => {
		const original = 42;
		const cursor = encodeCursor(original);
		const decoded = decodeCursor(cursor);
		expect(decoded).toBe(original);
	});

	it('should decode Date values', () => {
		const original = new Date('2024-01-15T10:30:00.000Z');
		const cursor = encodeCursor(original);
		const decoded = decodeCursor(cursor);

		expect(decoded).toBeInstanceOf(Date);
		expect((decoded as Date).toISOString()).toBe(original.toISOString());
	});

	it('should decode null values', () => {
		const cursor = encodeCursor(null);
		const decoded = decodeCursor(cursor);
		expect(decoded).toBeNull();
	});

	it('should decode boolean values', () => {
		const cursorTrue = encodeCursor(true);
		const cursorFalse = encodeCursor(false);

		expect(decodeCursor(cursorTrue)).toBe(true);
		expect(decodeCursor(cursorFalse)).toBe(false);
	});

	it('should throw error for invalid cursor format', () => {
		expect(() => decodeCursor('invalid-cursor')).toThrow(
			'Invalid cursor format',
		);
	});

	it('should throw error for malformed base64', () => {
		expect(() => decodeCursor('!!!')).toThrow('Invalid cursor format');
	});

	it('should throw error for non-JSON content', () => {
		// Valid base64 but not JSON
		const invalidCursor = Buffer.from('not json').toString('base64url');
		expect(() => decodeCursor(invalidCursor)).toThrow('Invalid cursor format');
	});
});

describe('encodeCursor and decodeCursor roundtrip', () => {
	it('should roundtrip string values', () => {
		const values = [
			'hello',
			'',
			'special chars: !@#$%',
			'unicode: \u00e9\u00e8',
		];

		for (const value of values) {
			expect(decodeCursor(encodeCursor(value))).toBe(value);
		}
	});

	it('should roundtrip number values', () => {
		const values = [0, 1, -1, 3.14, Number.MAX_SAFE_INTEGER];

		for (const value of values) {
			expect(decodeCursor(encodeCursor(value))).toBe(value);
		}
	});

	it('should roundtrip Date values', () => {
		const dates = [
			new Date(),
			new Date('2020-01-01T00:00:00.000Z'),
			new Date(0),
		];

		for (const date of dates) {
			const decoded = decodeCursor(encodeCursor(date));
			expect(decoded).toBeInstanceOf(Date);
			expect((decoded as Date).getTime()).toBe(date.getTime());
		}
	});
});
