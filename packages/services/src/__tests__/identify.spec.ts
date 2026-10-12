import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from '@geekmidas/logger';
import { describe, expect, it } from 'vitest';
import {
	currentRequestContext,
	identifyRequest,
	runWithRequestContext,
	serviceContext,
} from '../context';

/** A line as a logger wrote it: its message, with every binding it carried. */
interface Line {
	msg: string;
	[binding: string]: unknown;
}

/**
 * A logger that keeps what it writes, with the bindings `child()` gave it —
 * the behaviour that matters here, without a real transport.
 */
function recordingLogger(
	lines: Line[] = [],
	bindings: Record<string, unknown> = {},
): Logger & { lines: Line[] } {
	const write = (msg: string) => lines.push({ ...bindings, msg });
	return {
		lines,
		trace: write,
		debug: write,
		info: write,
		warn: write,
		error: write,
		fatal: write,
		child: (more: Record<string, unknown>) =>
			recordingLogger(lines, { ...bindings, ...more }),
	} as unknown as Logger & { lines: Line[] };
}

/** Run `fn` as a request of its own, with a logger bound to its id. */
function request<T>(
	root: Logger,
	requestId: string,
	fn: () => Promise<T>,
): Promise<T> {
	return runWithRequestContext(
		{
			logger: root.child({ requestId }),
			requestId,
			startTime: Date.now(),
		},
		fn,
	) as Promise<T>;
}

describe('identifyRequest', () => {
	it('keeps who the request is for on its context', async () => {
		await request(recordingLogger(), 'r1', async () => {
			expect(serviceContext.getUser()).toBeUndefined();

			expect(identifyRequest({ id: 'u1', sessionId: 's1' })).toBe(true);

			expect(serviceContext.getUser()).toEqual({ id: 'u1', sessionId: 's1' });
			expect(currentRequestContext()?.user).toEqual({
				id: 'u1',
				sessionId: 's1',
			});
		});
	});

	it('binds every later line of the request to the user, keeping its own bindings', async () => {
		const root = recordingLogger();

		await request(root, 'r1', async () => {
			currentRequestContext()!.logger.info('before');
			identifyRequest({ id: 'u1', sessionId: 's1' });
			currentRequestContext()!.logger.info('after');
		});

		expect(root.lines).toEqual([
			{ requestId: 'r1', msg: 'before' },
			{ requestId: 'r1', userId: 'u1', sessionId: 's1', msg: 'after' },
		]);
	});

	it('reaches a service that captured the logger before the request was identified', async () => {
		const root = recordingLogger();

		await request(root, 'r1', async () => {
			// What a singleton service does in register(): take it once.
			const captured = serviceContext.getLogger();
			identifyRequest({ id: 'u1' });
			captured.info('from the service');
		});

		expect(root.lines).toEqual([
			{ requestId: 'r1', userId: 'u1', msg: 'from the service' },
		]);
	});

	it('keeps the user across every async hop the request makes', async () => {
		await request(recordingLogger(), 'r1', async () => {
			identifyRequest({ id: 'u1' });

			const seen = await Promise.all([
				(async () => {
					await sleep(5);
					return serviceContext.getUser()?.id;
				})(),
				new Promise((resolve) =>
					setImmediate(() => resolve(serviceContext.getUser()?.id)),
				),
				new Promise((resolve) =>
					setTimeout(() => resolve(serviceContext.getUser()?.id), 1),
				),
				Promise.resolve().then(async () => {
					await sleep(1);
					return (async () => serviceContext.getUser()?.id)();
				}),
			]);

			expect(seen).toEqual(['u1', 'u1', 'u1', 'u1']);
		});
	});

	it('is seen by work started before the request was identified', async () => {
		// The store is the request's, not the moment's: something already
		// awaiting when the session is verified reads the user once it resumes.
		await request(recordingLogger(), 'r1', async () => {
			const later = (async () => {
				await sleep(5);
				return serviceContext.getUser()?.id;
			})();
			identifyRequest({ id: 'u1' });

			expect(await later).toBe('u1');
		});
	});

	it('never lets one request see another’s user, however they interleave', async () => {
		const root = recordingLogger();
		const users = ['ada', 'grace', 'linus', 'margaret', 'ken'];

		const seen = await Promise.all(
			users.map((user, i) =>
				request(root, `r-${user}`, async () => {
					// Identify in a different order than the requests started.
					await sleep((users.length - i) * 3);
					identifyRequest({ id: user });
					await sleep(i * 2);
					serviceContext.getLogger().info('done');
					return serviceContext.getUser()?.id;
				}),
			),
		);

		expect(seen).toEqual(users);
		for (const user of users) {
			expect(root.lines).toContainEqual({
				requestId: `r-${user}`,
				userId: user,
				msg: 'done',
			});
		}
		// No line is bound to a user other than its request's.
		for (const line of root.lines) {
			expect(line.requestId).toBe(`r-${line.userId}`);
		}
	});

	it('does not reach a request that was never identified', async () => {
		const root = recordingLogger();

		await Promise.all([
			request(root, 'r1', async () => {
				identifyRequest({ id: 'u1' });
				await sleep(2);
			}),
			request(root, 'r2', async () => {
				await sleep(4);
				serviceContext.getLogger().info('anonymous');
				expect(serviceContext.getUser()).toBeUndefined();
			}),
		]);

		expect(root.lines).toEqual([{ requestId: 'r2', msg: 'anonymous' }]);
	});

	it('replaces the user when identified again, never binding two', async () => {
		const root = recordingLogger();

		await request(root, 'r1', async () => {
			identifyRequest({ id: 'u1', sessionId: 's1' });
			identifyRequest({ id: 'u2' });
			serviceContext.getLogger().info('who');

			expect(serviceContext.getUser()).toEqual({ id: 'u2' });
		});

		expect(root.lines).toEqual([{ requestId: 'r1', userId: 'u2', msg: 'who' }]);
	});

	it('does nothing outside a request', () => {
		expect(identifyRequest({ id: 'u1' })).toBe(false);
		expect(serviceContext.getUser()).toBeUndefined();
	});
});
