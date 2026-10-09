/**
 * The errors gkm raises on purpose.
 *
 * A {@link GkmError} is a failure gkm saw coming and explained: a stage
 * missing a key, a config that names nothing, no AWS credentials. Its
 * message is the whole answer — what went wrong and what to do — so the CLI
 * prints `Name: message` and nothing else. A stack trace under it would point
 * at gkm's own code, which is not where the fix is.
 *
 * Anything else that reaches the CLI — a TypeError, an SDK error nothing
 * wrapped — is a failure nobody explained, and keeps its stack. `--debug` or
 * `GKM_DEBUG=1` shows the stack of both.
 */
export class GkmError extends Error {}

/** Whether `error` is one gkm raised on purpose — see {@link GkmError}. */
export function isGkmError(error: unknown): error is GkmError {
	return error instanceof GkmError;
}
