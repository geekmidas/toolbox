import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeHooksConfig } from '../dev';

describe('normalizeHooksConfig', () => {
	const originalCwd = process.cwd();

	beforeEach(() => {
		vi.spyOn(process, 'cwd').mockReturnValue('/test/project');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('should return undefined when hooks config is undefined', () => {
		const result = normalizeHooksConfig(undefined);
		expect(result).toBeUndefined();
	});

	it('should return undefined when hooks config is empty object', () => {
		const result = normalizeHooksConfig({});
		expect(result).toBeUndefined();
	});

	it('should return undefined when server hooks path is not provided', () => {
		const result = normalizeHooksConfig({ server: undefined });
		expect(result).toBeUndefined();
	});

	it('should normalize path with .ts extension', () => {
		const result = normalizeHooksConfig({ server: './src/hooks.ts' });

		expect(result).toBeDefined();
		expect(result!.serverHooksPath).toBe('/test/project/src/hooks.ts');
	});

	it('should add .ts extension when missing', () => {
		const result = normalizeHooksConfig({ server: './src/hooks' });

		expect(result).toBeDefined();
		expect(result!.serverHooksPath).toBe('/test/project/src/hooks.ts');
	});

	it('should resolve relative paths from cwd', () => {
		const result = normalizeHooksConfig({ server: 'config/server-hooks' });

		expect(result).toBeDefined();
		expect(result!.serverHooksPath).toBe(
			'/test/project/config/server-hooks.ts',
		);
	});

	it('should handle nested directory paths', () => {
		const result = normalizeHooksConfig({
			server: './src/config/hooks/server',
		});

		expect(result).toBeDefined();
		expect(result!.serverHooksPath).toBe(
			'/test/project/src/config/hooks/server.ts',
		);
	});
});
