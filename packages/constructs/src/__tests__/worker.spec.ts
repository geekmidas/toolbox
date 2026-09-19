import { describe, expect, it } from 'vitest';
import { CronBuilder } from '../crons/CronBuilder';
import { KyselyDatabase } from '../database/kysely';
import { Worker } from '../worker';

/** A logger distinguishable from the console default. */
const testLogger = () => {
	const logger = {
		info() {},
		warn() {},
		error() {},
		debug() {},
		trace() {},
		fatal() {},
		child() {
			return logger;
		},
	};
	return logger as never;
};

describe('Worker', () => {
	it('declares a process with no port', () => {
		const [declaration] = new Worker('Worker').declare();

		expect(declaration).toEqual({
			kind: 'worker',
			id: 'Worker',
			// Nothing calls a worker, so it publishes no address. A `RestApi`
			// provides three.
			provides: [],
		});
	});

	it('takes no authorizer, because nothing reaches it from outside', () => {
		const [declaration] = new Worker('Worker').declare();

		expect(declaration).not.toHaveProperty('defaultAuthorizer');
		expect(declaration).not.toHaveProperty('authorizers');
	});

	it('canonicalises its id the way every other construct does', () => {
		const [declaration] = new Worker('background-jobs').declare();

		expect(declaration?.id).toBe('BackgroundJobs');
	});

	it('names no app, because the id already says where it lives', () => {
		const [declaration] = new Worker('Worker').declare();

		expect(declaration).not.toHaveProperty('app');
	});

	it('carries an app spec when the layout differs', () => {
		const [declaration] = new Worker('Worker', {
			app: { path: 'services/jobs' },
		}).declare();

		expect(declaration).toMatchObject({ app: { path: 'services/jobs' } });
	});

	describe('the factories it hands out', () => {
		it('gives a cron its logger, so the file does not import one', () => {
			const logger = testLogger();
			const worker = new Worker('Worker', { logger });

			const cron = worker.cron('rate(1 day)').handle(async () => {});

			expect(cron.logger).toBe(logger);
		});

		it('gives a subscriber its logger', () => {
			const logger = testLogger();
			const worker = new Worker('Worker', { logger });

			expect(
				(worker.subscribers as unknown as { _logger: unknown })._logger,
			).toBe(logger);
		});

		it('gives a function its logger', () => {
			const logger = testLogger();
			const worker = new Worker('Worker', { logger });

			expect(
				(worker.functions as unknown as { _logger: unknown })._logger,
			).toBe(logger);
		});

		it('carries the schedule through the sugar', () => {
			const cron = new Worker('Worker')
				.cron('rate(1 day)')
				.handle(async () => {});

			expect(cron.schedule).toBe('rate(1 day)');
		});

		it('falls back to the console logger when none was given', () => {
			const cron = new Worker('Worker')
				.cron('rate(1 h)')
				.handle(async () => {});

			expect(cron.logger).toBeDefined();
		});
	});

	describe('ownership', () => {
		it('stamps its id onto everything built from its factories', () => {
			const worker = new Worker('Jobs');

			const cron = worker.cron('rate(1 day)').handle(async () => {});
			const fn = worker.functions.handle(async () => {});

			// One field says which process runs a construct, whatever its kind.
			// Before this, only the directory said it.
			expect(cron.owner).toBe('Jobs');
			expect(fn.owner).toBe('Jobs');
		});

		it('stamps the canonical id, not what was typed', () => {
			const cron = new Worker('background-jobs')
				.cron('rate(1 day)')
				.handle(async () => {});

			expect(cron.owner).toBe('BackgroundJobs');
		});

		it('leaves a free-standing builder unowned', () => {
			// `c`, `s` and `f` still work and still belong to nothing — which is
			// the state the directory used to paper over.
			const cron = new CronBuilder()
				.schedule('rate(1 day)')
				.handle(async () => {});

			expect(cron.owner).toBeUndefined();
		});
	});

	describe('.calls()', () => {
		it('records an edge without mutating the worker it came from', () => {
			const database = new KyselyDatabase<Record<string, never>, 'Db'>('Db');
			const worker = new Worker('Worker');

			const withDatabase = worker.calls([database]);

			expect(withDatabase.declare()[0]).toMatchObject({
				dependencies: [expect.objectContaining({ target: 'Db' })],
			});
			// The original is untouched — immutable, like every other builder.
			expect(worker.declare()[0]).not.toHaveProperty('dependencies');
		});

		it('keeps the logger across the copy', () => {
			const logger = testLogger();
			const database = new KyselyDatabase<Record<string, never>, 'Db'>('Db');

			const worker = new Worker('Worker', { logger }).calls([database]);

			expect(worker.logger).toBe(logger);
		});
	});
});
