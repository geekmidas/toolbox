/**
 * The errors the edge raises on purpose.
 *
 * Like the CLI's `GkmError`: a failure seen coming and explained, whose
 * message is the whole answer. The CLI prints one without a stack trace.
 */
export class EdgeError extends Error {}

/** Whether `error` is one the edge raised on purpose. */
export function isEdgeError(error: unknown): error is EdgeError {
	return error instanceof EdgeError;
}
