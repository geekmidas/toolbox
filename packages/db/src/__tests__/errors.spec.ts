import { describe, expect, it } from 'vitest';
import { redactDatabaseUrl } from '../errors';

describe('redactDatabaseUrl', () => {
	it('replaces the password and leaves everything else readable', () => {
		expect(redactDatabaseUrl('postgres://app:hunter2@db.internal/orders')).toBe(
			'postgres://app:***@db.internal/orders',
		);
	});

	it('leaves a URL with no password untouched', () => {
		expect(redactDatabaseUrl('postgres://db.internal/orders')).toBe(
			'postgres://db.internal/orders',
		);
	});

	it('keeps the role visible, which is usually what you are debugging', () => {
		expect(
			redactDatabaseUrl('postgres://app_owner:s3cret@db.internal/orders'),
		).toContain('app_owner');
	});

	it('works on any engine, not just postgres', () => {
		expect(redactDatabaseUrl('mysql://root:hunter2@localhost/app')).toBe(
			'mysql://root:***@localhost/app',
		);
	});

	it('withholds anything it cannot parse rather than echoing it', () => {
		// Unparseable input may still be secret — a mistyped scheme on a real
		// connection string, say — and this runs on paths that must not throw.
		expect(redactDatabaseUrl('host=db dbname=orders password=hunter2')).toBe(
			'<unparseable url>',
		);
	});

	it('does not throw on empty input', () => {
		expect(redactDatabaseUrl('')).toBe('<unparseable url>');
	});
});
