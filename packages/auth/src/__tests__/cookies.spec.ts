import { describe, expect, it } from 'vitest';
import { readCookie } from '../cookies';

describe('readCookie', () => {
	it('reads a cookie by name', () => {
		expect(readCookie('auth_token=GOOD', 'auth_token')).toBe('GOOD');
	});

	it('reads a cookie that is not the first in the header', () => {
		expect(readCookie('theme=dark; auth_token=GOOD', 'auth_token')).toBe(
			'GOOD',
		);
	});

	it('does not let a cookie whose name ends with the wanted one stand in', () => {
		// The attack: the browser sends both, and a substring search finds the
		// attacker's pair first because it comes first in the header.
		expect(
			readCookie('evil_auth_token=ATTACKER; auth_token=GOOD', 'auth_token'),
		).toBe('GOOD');
	});

	it('does not match a name that merely contains the wanted one', () => {
		expect(readCookie('xauth_tokenx=ATTACKER', 'auth_token')).toBeNull();
	});

	it('does not match a value that contains the wanted name', () => {
		expect(readCookie('other=auth_token=ATTACKER', 'auth_token')).toBeNull();
	});

	it('treats the name literally, not as a pattern', () => {
		expect(readCookie('a.b=REAL', 'a.b')).toBe('REAL');
		expect(readCookie('axb=ATTACKER', 'a.b')).toBeNull();
	});

	it('tolerates spaces around the pairs', () => {
		expect(readCookie(' theme=dark ;  auth_token = GOOD ', 'auth_token')).toBe(
			'GOOD',
		);
	});

	it('returns null for an empty value, a missing name and no header', () => {
		expect(readCookie('auth_token=', 'auth_token')).toBeNull();
		expect(readCookie('theme=dark', 'auth_token')).toBeNull();
		expect(readCookie(undefined, 'auth_token')).toBeNull();
	});

	it('ignores a bare flag with no value', () => {
		expect(readCookie('auth_token; auth_token=GOOD', 'auth_token')).toBe(
			'GOOD',
		);
	});
});
