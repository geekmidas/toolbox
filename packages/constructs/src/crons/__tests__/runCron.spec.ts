import { EnvironmentParser } from '@geekmidas/envkit';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { CronBuilder } from '../CronBuilder';
import { runCron } from '../runCron';

/** A database the way a construct provides one: a service, registered once. */
const database = {
	serviceName: 'database' as const,
	async register() {
		return { name: 'orders-db' };
	},
} satisfies Service<'database', { name: string }>;

const counter = {
	serviceName: 'counter' as const,
	async register() {
		let count = 0;
		return { increment: () => ++count };
	},
} satisfies Service<'counter', { increment(): number }>;

describe('runCron', () => {
	let discovery: ServiceDiscovery<any>;

	beforeEach(() => {
		ServiceDiscovery.reset();
		discovery = ServiceDiscovery.getInstance(new EnvironmentParser({}));
	});

	it('runs the cron with its services and its database as `db`, as Lambda would', async () => {
		const cron = new CronBuilder()
			.schedule('rate(1 hour)')
			.database(database)
			.services([counter])
			.output(z.object({ db: z.string(), count: z.number() }))
			.handle(async ({ db, services }) => ({
				db: db.name,
				count: services.counter.increment(),
			}));

		expect(await runCron(cron, discovery)).toEqual({
			db: 'orders-db',
			count: 1,
		});
		// One instance across runs: firing every minute reconnects nothing.
		expect(await runCron(cron, discovery)).toEqual({
			db: 'orders-db',
			count: 2,
		});
	});

	it('rejects with what the cron threw, so the scheduler can report it', async () => {
		class Boom extends Error {}
		const cron = new CronBuilder().schedule('rate(1 hour)').handle(async () => {
			throw new Boom();
		});

		await expect(runCron(cron, discovery)).rejects.toBeInstanceOf(Boom);
	});
});
