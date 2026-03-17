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
 * Always includes the full stack trace since these are process-ending errors.
 */
export function formatError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
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
