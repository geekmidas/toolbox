import type { z } from 'zod/v4';

/**
 * Options for formatting parse errors.
 */
export interface FormatOptions {
	/** Whether to use colors in output. Defaults to auto-detect TTY. */
	colors?: boolean;
}

/**
 * ANSI color codes for terminal output.
 */
const colors = {
	reset: '\x1b[0m',
	red: '\x1b[31m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
	dim: '\x1b[2m',
	bold: '\x1b[1m',
};

/**
 * Formats a ZodError into a user-friendly string for development.
 *
 * @param error - The ZodError to format
 * @param options - Formatting options
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * try {
 *   config.parse();
 * } catch (error) {
 *   if (error instanceof ZodError) {
 *     console.error(formatParseError(error));
 *   }
 * }
 * ```
 *
 * Output:
 * ```
 * Environment Configuration Failed
 *
 * Missing Variables:
 *   DATABASE_URL - Required
 *   JWT_SECRET - Required
 *
 * Invalid Values:
 *   NODE_ENV = "invalid"
 *     Expected: "development" | "staging" | "production"
 * ```
 */
export function formatParseError(
	error: z.ZodError,
	options: FormatOptions = {},
): string {
	const useColors =
		options.colors ?? (process.stdout?.isTTY && process.env.NO_COLOR == null);

	const c = useColors
		? colors
		: { reset: '', red: '', yellow: '', cyan: '', dim: '', bold: '' };

	const missingVars: Array<{ name: string; message: string }> = [];
	const invalidVars: Array<{ name: string; value: unknown; message: string }> =
		[];

	for (const issue of error.issues) {
		// Extract environment variable name from path or message
		let envName = '';
		if (issue.path.length > 0) {
			envName = String(issue.path[0]);
		} else {
			// Try to extract from message like 'Environment variable "NAME": ...'
			const match = issue.message.match(/Environment variable "([^"]+)"/);
			if (match?.[1]) {
				envName = match[1];
			}
		}

		// Determine if this is a missing or invalid value
		// Use type guard for received property
		const received = 'received' in issue ? issue.received : undefined;
		const isMissing =
			issue.code === 'invalid_type' &&
			(received === 'undefined' || received === 'null');

		if (isMissing) {
			missingVars.push({
				name: envName || 'Unknown',
				message: cleanMessage(issue.message),
			});
		} else {
			invalidVars.push({
				name: envName || 'Unknown',
				value: received,
				message: cleanMessage(issue.message),
			});
		}
	}

	const lines: string[] = [];

	lines.push('');
	lines.push(`${c.red}${c.bold}Environment Configuration Failed${c.reset}`);
	lines.push('');

	if (missingVars.length > 0) {
		lines.push(`${c.yellow}Missing Variables:${c.reset}`);
		for (const v of missingVars) {
			lines.push(`  ${c.cyan}${v.name}${c.reset} ${c.dim}- Required${c.reset}`);
		}
		lines.push('');
	}

	if (invalidVars.length > 0) {
		lines.push(`${c.yellow}Invalid Values:${c.reset}`);
		for (const v of invalidVars) {
			const valueStr =
				v.value !== undefined ? ` = ${JSON.stringify(v.value)}` : '';
			lines.push(`  ${c.cyan}${v.name}${c.reset}${valueStr}`);
			lines.push(`    ${c.dim}${v.message}${c.reset}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

/**
 * Cleans up a Zod error message by removing redundant prefixes.
 */
function cleanMessage(message: string): string {
	// Remove "Environment variable "NAME": " prefix if present
	return message.replace(/^Environment variable "[^"]+": /, '');
}

/**
 * Checks if the current environment is development.
 */
export function isDevelopment(): boolean {
	const nodeEnv = process.env.NODE_ENV?.toLowerCase();
	return nodeEnv == null || nodeEnv === 'development' || nodeEnv === 'dev';
}
