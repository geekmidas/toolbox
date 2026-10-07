import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../pino';

/** The real `createLogger`, writing parsed JSON lines to an array. */
function capture(options: Parameters<typeof createLogger>[0] = {}) {
	const logs: Record<string, any>[] = [];
	const destination = new Writable({
		write(chunk, _encoding, callback) {
			for (const line of chunk.toString().split('\n')) {
				if (line.trim()) logs.push(JSON.parse(line));
			}
			callback();
		},
	});
	return { logger: createLogger({ ...options, destination }), logs };
}

describe('logging an Error', () => {
	it('serializes one under `error` with its message and stack', () => {
		const { logger, logs } = capture();

		logger.error({ error: new TypeError('the handler broke') }, 'Failed');

		expect(logs[0].error).toMatchObject({
			type: 'TypeError',
			message: 'the handler broke',
		});
		expect(logs[0].error.stack).toContain('TypeError: the handler broke');
	});

	it('serializes one under `err` with its message and stack', () => {
		const { logger, logs } = capture();

		logger.error({ err: new RangeError('out of range') }, 'Failed');

		expect(logs[0].err).toMatchObject({
			type: 'RangeError',
			message: 'out of range',
		});
		expect(logs[0].err.stack).toContain('RangeError: out of range');
	});

	it('keeps an Error’s own fields and its cause', () => {
		const { logger, logs } = capture();
		const error = Object.assign(
			new Error('insert failed', { cause: new Error('connection reset') }),
			{ code: '23505' },
		);

		logger.error({ error }, 'Failed');

		// pino's serializer folds the cause into the message and the stack.
		expect(logs[0].error).toMatchObject({
			message: 'insert failed: connection reset',
			code: '23505',
		});
		expect(logs[0].error.stack).toContain('connection reset');
	});

	it('leaves a non-Error `error` as it was', () => {
		const { logger, logs } = capture();

		logger.error({ error: 'a string' }, 'Failed');
		logger.error({ error: { reason: 'quota' } }, 'Failed');

		expect(logs[0].error).toBe('a string');
		expect(logs[1].error).toEqual({ reason: 'quota' });
	});

	it('masks URL credentials in the message and the stack', () => {
		const { logger, logs } = capture();

		logger.error(
			{ error: new Error('cannot reach postgres://app:hunter2@db:5432/app') },
			'Failed',
		);

		expect(logs[0].error.message).not.toContain('hunter2');
		expect(logs[0].error.stack).not.toContain('hunter2');
		expect(logs[0].error.message).toContain('postgres://');
	});

	it('applies path redaction to the serialized fields', () => {
		const { logger, logs } = capture({
			redact: ['error.message', 'err.stack'],
		});

		logger.error({ error: new Error('secret detail') }, 'Failed');
		logger.error({ err: new Error('other detail') }, 'Failed');

		expect(logs[0].error.message).toBe('[Redacted]');
		expect(logs[0].error.stack).toContain('secret detail');
		expect(logs[1].err.stack).toBe('[Redacted]');
		expect(logs[1].err.message).toBe('other detail');
	});

	it('leaves URL credentials alone when redaction is off', () => {
		const { logger, logs } = capture({ redact: false });

		logger.error({ error: new Error('postgres://app:hunter2@db/app') }, 'x');

		expect(logs[0].error.message).toContain('hunter2');
	});
});
