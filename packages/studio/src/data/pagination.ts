/**
 * Cursor encoding/decoding utilities for pagination.
 */

/**
 * Encode a cursor value for safe URL transmission.
 * Supports various types: string, number, Date, etc.
 */
export function encodeCursor(value: unknown): string {
	const payload = {
		v: value instanceof Date ? value.toISOString() : value,
		t: value instanceof Date ? 'date' : typeof value,
	};
	return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a cursor string back to its original value.
 */
export function decodeCursor(cursor: string): unknown {
	try {
		const json = Buffer.from(cursor, 'base64url').toString('utf-8');
		const payload = JSON.parse(json);

		if (payload.t === 'date') {
			return new Date(payload.v);
		}

		return payload.v;
	} catch {
		throw new Error('Invalid cursor format');
	}
}
