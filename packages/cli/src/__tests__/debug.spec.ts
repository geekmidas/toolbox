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

describe('formatError for an error gkm raised on purpose', () => {
	afterEach(() => vi.unstubAllEnvs());

	/** A named error, as every one gkm raises is written. */
	async function named() {
		const { GkmError } = await import('../errors');
		class StageNotReady extends GkmError {
			constructor(readonly stage: string) {
				super(
					`The stage '${stage}' is not ready. Run gkm setup --stage ${stage}.`,
				);
				this.name = 'StageNotReady';
			}
		}
		return new StageNotReady('prod');
	}

	it('prints its name and message, and no stack', async () => {
		vi.stubEnv('GKM_DEBUG', '');
		const { formatError } = await fresh();
		const error = await named();

		expect(formatError(error)).toBe(
			"StageNotReady: The stage 'prod' is not ready. Run gkm setup --stage prod.",
		);
	});

	it('names what it wraps by its message alone', async () => {
		vi.stubEnv('GKM_DEBUG', '');
		const { formatError } = await fresh();
		const error = await named();
		const cause = Object.assign(new Error('Could not load credentials'), {
			name: 'CredentialsProviderError',
		});
		Object.assign(error, { cause });

		const out = formatError(error);

		expect(out).toContain(
			'Caused by: CredentialsProviderError: Could not load credentials',
		);
		expect(out).not.toContain(cause.stack!);
		expect(out).not.toMatch(/\n\s+at /);
	});

	it('prints the stack in debug mode', async () => {
		vi.stubEnv('GKM_DEBUG', '1');
		const { formatError } = await fresh();
		const error = await named();

		expect(formatError(error)).toBe(error.stack);
	});

	it('keeps the stack of an error nobody explained', async () => {
		vi.stubEnv('GKM_DEBUG', '');
		const { formatError } = await fresh();
		const error = new TypeError(
			"Cannot read properties of undefined (reading 'id')",
		);

		expect(formatError(error)).toBe(error.stack);
	});
});

describe('exitWithError', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('prints the error on stderr and exits 1', async () => {
		vi.stubEnv('GKM_DEBUG', '');
		const { exitWithError } = await fresh();
		const { GkmError } = await import('../errors');
		const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exited');
		});
		class NothingToDo extends GkmError {
			constructor() {
				super('Nothing to do.');
				this.name = 'NothingToDo';
			}
		}

		expect(() => exitWithError(new NothingToDo())).toThrow('exited');
		expect(stderr).toHaveBeenCalledWith('NothingToDo: Nothing to do.');
		expect(exit).toHaveBeenCalledWith(1);
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
