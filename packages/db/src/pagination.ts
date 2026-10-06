/**
 * Sort direction for cursor-based pagination.
 */
export enum Direction {
	Asc = 'asc',
	Desc = 'desc',
}

/**
 * Result of a paginated query.
 */
export interface PaginationResult<TItem> {
	items: TItem[];
	pagination: {
		total: number;
		hasMore: boolean;
		cursor?: string;
	};
}

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
		throw new InvalidCursor(cursor);
	}
}

/**
 * A cursor that did not come from `encodeCursor`.
 *
 * Usually a cursor from a different page size or sort that was edited by hand,
 * or truncated on its way through a URL. The fix is the same either way: start
 * again from the first page.
 */
export class InvalidCursor extends Error {
	constructor(readonly cursor: string) {
		super(
			'This cursor was not produced by encodeCursor. Drop it and request the first page again.',
		);
		this.name = 'InvalidCursor';
	}
}
