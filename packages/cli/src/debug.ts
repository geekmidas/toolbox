import { isGkmError } from './errors';

let _debug = false;

/**
 * Enable debug mode globally.
 * When enabled, verbose error details are shown everywhere.
 */
export function enableDebug(): void {
	_debug = true;
}

/**
 * Check if debug mode is active.
 * Activated by `--debug` flag or `GKM_DEBUG=1` env var.
 */
export function isDebug(): boolean {
	return _debug || process.env.GKM_DEBUG === '1';
}

/**
 * Log a message only when debug mode is active.
 */
export function debug(...args: unknown[]): void {
	if (isDebug()) {
		console.debug('[debug]', ...args);
	}
}

/**
 * Format a fatal error for display.
 *
 * An error gkm raised on purpose ({@link isGkmError}) is `Name: message` —
 * its message is the answer, and a stack would only point into gkm. Anything
 * else is unexpected, and prints its stack and every cause beneath it. Debug
 * mode prints the stack of both.
 */
export function formatError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}

	if (isGkmError(error) && !isDebug()) {
		// What it wraps, by its message alone: the reason, not where it was.
		const cause = error.cause;
		return cause === undefined
			? `${error.name}: ${error.message}`
			: `${error.name}: ${error.message}\n\nCaused by: ${
					cause instanceof Error
						? `${cause.name}: ${cause.message}`
						: String(cause)
				}`;
	}

	let output = error.stack ?? error.message;

	// Include cause chain if present
	let cause = error.cause;
	while (cause) {
		if (cause instanceof Error) {
			output += `\n\nCaused by: ${cause.stack ?? cause.message}`;
			cause = cause.cause;
		} else {
			output += `\n\nCaused by: ${String(cause)}`;
			break;
		}
	}

	return output;
}

/**
 * End a command that failed: print the error ({@link formatError}) on stderr
 * and exit 1. What every command's action does with what it throws.
 */
export function exitWithError(error: unknown): never {
	console.error(formatError(error));
	process.exit(1);
}

/**
 * Format a non-fatal error for display.
 * Shows only the message by default, full stack in debug mode.
 */
export function formatWarning(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}

	if (!isDebug()) {
		return error.message;
	}

	return error.stack ?? error.message;
}
