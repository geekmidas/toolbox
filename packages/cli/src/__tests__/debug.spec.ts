import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Debug mode is one flag, set once for the process by `--debug` or read from
 * `GKM_DEBUG`, so each case imports a fresh copy of the module.
 */
async function fresh() {
	vi.resetModules();
	return import('../debug');
}

describe('debug', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('is off until --debug turns it on', async () => {
		vi.stubEnv('GKM_DEBUG', '');
		const { enableDebug, isDebug } = await fresh();

		expect(isDebug()).toBe(false);
		enableDebug();
		expect(isDebug()).toBe(true);
	});

	it('is on when GKM_DEBUG=1', async () => {
		vi.stubEnv('GKM_DEBUG', '1');
		const { isDebug } = await fresh();

		expect(isDebug()).toBe(true);
	});

	it('logs only in debug mode', async () => {
		vi.stubEnv('GKM_DEBUG', '');
		const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		const { debug, enableDebug } = await fresh();

		debug('quiet');
		expect(spy).not.toHaveBeenCalled();

		enableDebug();
		debug('loud', 42);
		expect(spy).toHaveBeenCalledWith('[debug]', 'loud', 42);
	});
});

describe('formatError', () => {
	it('prints a non-error as a string', async () => {
		const { formatError } = await fresh();

		expect(formatError('plain')).toBe('plain');
		expect(formatError(404)).toBe('404');
	});

	it('prints the stack, and every cause beneath it', async () => {
		const { formatError } = await fresh();
		const root = new Error('connect ECONNREFUSED');
		const middle = new Error('could not reach Postgres', { cause: root });
		const top = new Error('reconcile failed', { cause: middle });

		const out = formatError(top);

		expect(out).toContain(top.stack!);
		expect(out).toContain(`Caused by: ${middle.stack}`);
		expect(out).toContain(`Caused by: ${root.stack}`);
	});

	it('stops at a cause that is not an error', async () => {
		const { formatError } = await fresh();
		const error = new Error('outer', { cause: { code: 'E_WEIRD' } });

		expect(formatError(error)).toContain('Caused by: [object Object]');
	});

	it('falls back to the message when there is no stack', async () => {
		const { formatError } = await fresh();
		const error = new Error('no stack here');
		error.stack = undefined;

		expect(formatError(error)).toBe('no stack here');
	});
});

describe('formatWarning', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('shows the message, and the stack only in debug mode', async () => {
		vi.stubEnv('GKM_DEBUG', '');
		const { enableDebug, formatWarning } = await fresh();
		const error = new Error('port 5432 is taken');

		expect(formatWarning('text')).toBe('text');
		expect(formatWarning(error)).toBe('port 5432 is taken');

		enableDebug();
		expect(formatWarning(error)).toBe(error.stack);
		error.stack = undefined;
		expect(formatWarning(error)).toBe('port 5432 is taken');
	});
});
