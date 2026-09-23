import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { dropSchemas } from './setup';

/**
 * The guarantee the server-side cron runtime rests on.
 *
 * A server target has nothing firing its crons but itself. The obvious
 * implementation — a timer in the process — is wrong the moment the deployment
 * runs more than one replica: each replica holds its own timer, each fires, and
 * nothing anywhere reports it. The symptom is duplicated work, which surfaces
 * as bad data rather than as an error, days later.
 *
 * Keeping the schedule in Postgres is what avoids that, and this is the test of
 * it rather than the argument for it: two processes schedule the same cron and
 * the job runs once.
 *
 * It exercises pg-boss directly because that is what the generated `crons.ts`
 * does, and the generated file cannot be imported from here.
 */

const POSTGRES_URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const SCHEMA = 'pgboss_replica_test';

beforeAll(async () => {
	await dropSchemas(POSTGRES_URL, [SCHEMA]);
});

/** Two instances of the same app, as a deployment with two replicas has. */
async function replicas(count: number): Promise<PgBoss[]> {
	const started = [];
	for (let i = 0; i < count; i++) {
		const boss = new PgBoss({
			connectionString: POSTGRES_URL,
			schema: SCHEMA,
		});
		await boss.start();
		started.push(boss);
	}

	return started;
}

/** Polls rather than sleeping a fixed time, so a slow machine does not flake. */
async function until(
	predicate: () => boolean,
	timeoutMs = 10_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describe('a cron scheduled by several replicas', () => {
	let bosses: PgBoss[] = [];

	afterAll(async () => {
		await Promise.all(bosses.map((boss) => boss.stop()));
		bosses = [];
	});

	it('is one schedule, however many processes declare it', async () => {
		bosses = await replicas(3);
		const queue = 'cron.cleanupStaleUsers';

		// Every replica boots the same code and schedules the same cron, because
		// none of them knows it is not the only one.
		for (const boss of bosses) {
			await boss.createQueue(queue);
			await boss.schedule(queue, '* * * * *', undefined, { tz: 'UTC' });
		}

		const schedules = await bosses[0]!.getSchedules();
		const mine = schedules.filter((s) => s.name === queue);

		// Not three. The schedule is a row keyed by name, so the second and third
		// replica update what the first wrote rather than adding their own.
		expect(mine).toHaveLength(1);
		expect(mine[0]?.cron).toBe('* * * * *');
	});

	it('delivers a firing to exactly one replica', async () => {
		bosses = await replicas(3);
		const queue = `cron.delivery-${Date.now()}`;

		let handled = 0;
		const handledBy: number[] = [];

		for (const [index, boss] of bosses.entries()) {
			await boss.createQueue(queue);
			await boss.work(queue, async () => {
				handled += 1;
				handledBy.push(index);
			});
		}

		// One firing of the schedule, which is one job.
		await bosses[0]!.send(queue, {});

		await until(() => handled > 0);
		// Long enough that a second replica taking the same job would show up.
		await new Promise((resolve) => setTimeout(resolve, 1_000));

		// The point of the whole design: three processes, one execution.
		expect(handled).toBe(1);
		expect(handledBy).toHaveLength(1);
	});

	it('leaves no schedule behind when a cron is renamed', async () => {
		bosses = await replicas(1);
		const boss = bosses[0]!;
		const gone = `cron.oldName-${Date.now()}`;
		const kept = `cron.newName-${Date.now()}`;

		for (const queue of [gone, kept]) {
			await boss.createQueue(queue);
			await boss.schedule(queue, '* * * * *', undefined, { tz: 'UTC' });
		}

		// What the app declares after the rename, and the reconciliation the
		// generated setup performs on boot. Without it the old schedule keeps
		// firing at a handler that no longer exists.
		const declared = new Set([kept]);
		for (const existing of await boss.getSchedules()) {
			if (existing.name.startsWith('cron.') && !declared.has(existing.name)) {
				await boss.unschedule(existing.name);
			}
		}

		const names = (await boss.getSchedules()).map((s) => s.name);
		expect(names).toContain(kept);
		expect(names).not.toContain(gone);
	});
});
