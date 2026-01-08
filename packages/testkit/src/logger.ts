import type { Logger } from '@geekmidas/logger';
import { vi } from 'vitest';

/**
 * Creates a mock Logger for testing
 */
export function createMockLogger(): Logger {
	const logger: Logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn(() => logger),
	};
	return logger;
}
