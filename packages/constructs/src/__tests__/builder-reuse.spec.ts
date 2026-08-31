/**
 * Builder reuse: a configured base works, and nothing crosses between chains.
 *
 * Two properties, asserted for every field on every builder that carries state.
 *
 * **Persistence** — `const base = f.logger(log).timeout(60_000)` keeps its
 * configuration for every construct built from it. It used to survive exactly
 * one `.handle()`: the reset block at the end put every field back to its
 * default, so the second function silently came back on the console logger and
 * a 30s timeout.
 *
 * **Isolation** — two chains off one base get only what each declared. They
 * used to be the same object, so a chain's function came out holding the other
 * chain's services too. In `constructs` that is an over-grant in the field a
 * deploy reads to size an IAM policy.
 *
 * Table-driven because the two properties are the same question asked of every
 * field, and the failure mode being guarded against is precisely a field nobody
 * remembered to handle. A field missing from a table here is an untested field
 * rather than a silent bug, which is the trade this shape makes.
 */

import type { AuditStorage } from '@geekmidas/audit';
import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { registerStorageDriver, type StorageClient } from '@geekmidas/storage';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CronBuilder } from '../crons/CronBuilder';
import { FunctionBuilder } from '../functions/FunctionBuilder';
import { ObjectStorage } from '../object-storage';
import { QueueBuilder } from '../queue/QueueBuilder';
import { SubscriberBuilder } from '../subscribers/SubscriberBuilder';
import { t } from '../topic';
import { TopicBuilder } from '../topic/TopicBuilder';

registerStorageDriver({
	scheme: 's3:',
	create: (url) => ({ url }) as unknown as StorageClient,
});

const uploads = new ObjectStorage('Uploads');
const emails = new ObjectStorage('Emails');

const serviceA = {
	serviceName: 'a' as const,
	async register() {
		return {};
	},
};
const serviceB = {
	serviceName: 'b' as const,
	async register() {
		return {};
	},
};

const loggerA = new ConsoleLogger({ which: 'a' });
const loggerB = new ConsoleLogger({ which: 'b' });

const schemaA = z.object({ a: z.string() });
const schemaB = z.object({ b: z.string() });

const publisherA = {
	serviceName: 'pa' as const,
	async register() {
		return {};
	},
};
const publisherB = {
	serviceName: 'pb' as const,
	async register() {
		return {};
	},
};

const auditA = {
	serviceName: 'aa' as const,
	async register() {
		return {} as AuditStorage;
	},
};
const auditB = {
	serviceName: 'ab' as const,
	async register() {
		return {} as AuditStorage;
	},
};

const dbA = {
	serviceName: 'da' as const,
	async register() {
		return {};
	},
};
const dbB = {
	serviceName: 'db' as const,
	async register() {
		return {};
	},
};

const topicA = t.topic('alpha').events({ 'a.one': z.object({}) });
const topicB = t.topic('beta').events({ 'b.one': z.object({}) });

/** One field: how to set it, and how to read it back off what was built. */
interface Field<B> {
	name: string;
	a: unknown;
	b: unknown;
	set: (builder: B, value: any) => B;
	get: (built: any) => unknown;
}

function reusable<B>(
	label: string,
	fresh: () => B,
	build: (builder: B) => unknown,
	fields: Field<B>[],
) {
	describe(label, () => {
		for (const field of fields) {
			it(`${field.name} — persists across builds off one base`, () => {
				const base = field.set(fresh(), field.a);

				// Built twice from the same base, with no clone in between: this
				// is the shape that stayed broken after the config methods were
				// made to clone, because `.handle()` still reset what it read.
				expect(field.get(build(base))).toEqual(field.a);
				expect(field.get(build(base))).toEqual(field.a);
			});

			it(`${field.name} — does not cross between chains off one base`, () => {
				const base = fresh();
				const one = field.set(base, field.a);
				const two = field.set(base, field.b);

				expect(field.get(build(one))).toEqual(field.a);
				expect(field.get(build(two))).toEqual(field.b);
			});

			it(`${field.name} — leaves the base it was set on untouched`, () => {
				const base = fresh();
				const untouched = field.get(build(base));

				field.set(base, field.a);

				expect(field.get(build(base))).toEqual(untouched);
			});
		}
	});
}

const names = (services: readonly Service[]) =>
	services.map((s) => s.serviceName);

reusable(
	'FunctionBuilder',
	() => new FunctionBuilder(),
	(b) => b.handle(async () => null),
	[
		{
			name: 'logger',
			a: loggerA,
			b: loggerB,
			set: (b, v) => b.logger(v),
			get: (f) => f.logger,
		},
		{
			name: 'timeout',
			a: 1000,
			b: 2000,
			set: (b, v) => b.timeout(v),
			get: (f) => f.timeout,
		},
		{
			name: 'memorySize',
			a: 128,
			b: 256,
			set: (b, v) => b.memorySize(v),
			get: (f) => f.memorySize,
		},
		{
			name: 'services',
			a: ['a'],
			b: ['b'],
			set: (b, v) => b.services([v[0] === 'a' ? serviceA : serviceB]),
			get: (f) => names(f.services),
		},
		{
			name: 'dependsOn',
			a: ['Uploads'],
			b: ['Emails'],
			set: (b, v) => b.dependsOn([v[0] === 'Uploads' ? uploads : emails]),
			get: (f) => f.constructs,
		},
		{
			name: 'input',
			a: schemaA,
			b: schemaB,
			set: (b, v) => b.input(v),
			get: (f) => f.input,
		},
		{
			name: 'output',
			a: schemaA,
			b: schemaB,
			set: (b, v) => b.output(v),
			get: (f) => f.outputSchema,
		},
		{
			name: 'publisher',
			a: publisherA,
			b: publisherB,
			set: (b, v) => b.publisher(v),
			get: (f) => f.publisherService,
		},
		{
			name: 'auditor',
			a: auditA,
			b: auditB,
			set: (b, v) => b.auditor(v),
			get: (f) => f.auditorStorageService,
		},
		{
			name: 'database',
			a: dbA,
			b: dbB,
			set: (b, v) => b.database(v),
			get: (f) => f.databaseService,
		},
		// Accumulating, like services and dependsOn: each chain adds its own, so
		// isolation means each holds only what it added — not that one holds more.
		{
			name: 'event',
			a: ['ea'],
			b: ['eb'],
			set: (b, v) => b.event({ type: v[0] } as any),
			get: (f) => f.events.map((e: any) => e.type),
		},
	] as Field<any>[],
);

reusable(
	'CronBuilder',
	() => new CronBuilder(),
	(b) => b.handle(async () => null),
	[
		{
			name: 'schedule',
			a: 'rate(1 day)',
			b: 'rate(2 days)',
			set: (b, v) => b.schedule(v),
			get: (c) => c.schedule,
		},
		{
			name: 'logger',
			a: loggerA,
			b: loggerB,
			set: (b, v) => b.logger(v),
			get: (c) => c.logger,
		},
		{
			name: 'timeout',
			a: 1000,
			b: 2000,
			set: (b, v) => b.timeout(v),
			get: (c) => c.timeout,
		},
		{
			name: 'memorySize',
			a: 128,
			b: 256,
			set: (b, v) => b.memorySize(v),
			get: (c) => c.memorySize,
		},
		{
			name: 'services',
			a: ['a'],
			b: ['b'],
			set: (b, v) => b.services([v[0] === 'a' ? serviceA : serviceB]),
			get: (c) => names(c.services),
		},
		{
			name: 'dependsOn',
			a: ['Uploads'],
			b: ['Emails'],
			set: (b, v) => b.dependsOn([v[0] === 'Uploads' ? uploads : emails]),
			get: (c) => c.constructs,
		},
		{
			name: 'input',
			a: schemaA,
			b: schemaB,
			set: (b, v) => b.input(v),
			get: (c) => c.input,
		},
		{
			name: 'output',
			a: schemaA,
			b: schemaB,
			set: (b, v) => b.output(v),
			get: (c) => c.outputSchema,
		},
		{
			name: 'publisher',
			a: publisherA,
			b: publisherB,
			set: (b, v) => b.publisher(v),
			get: (c) => c.publisherService,
		},
		{
			name: 'database',
			a: dbA,
			b: dbB,
			set: (b, v) => b.database(v),
			get: (c) => c.databaseService,
		},
	] as Field<any>[],
);

reusable(
	'QueueBuilder',
	() => new QueueBuilder().queue('base').message(z.object({})),
	(b) => b.handle(async () => {}),
	[
		{
			name: 'queue',
			a: 'alpha',
			b: 'beta',
			set: (b, v) => b.queue(v),
			get: (q) => q.name,
		},
		{
			name: 'message',
			a: schemaA,
			b: schemaB,
			set: (b, v) => b.message(v),
			get: (q) => q.messageSchema,
		},
		{
			name: 'timeout',
			a: 1000,
			b: 2000,
			set: (b, v) => b.timeout(v),
			get: (q) => q.timeout,
		},
		{
			name: 'batchSize',
			a: 5,
			b: 10,
			set: (b, v) => b.batchSize(v),
			get: (q) => q.batchSize,
		},
		{
			name: 'fifo',
			a: true,
			b: false,
			set: (b, v) => b.fifo(v),
			get: (q) => q.fifo,
		},
		{
			name: 'logger',
			a: loggerA,
			b: loggerB,
			set: (b, v) => b.logger(v),
			get: (q) => q.logger,
		},
		{
			name: 'services',
			a: ['a'],
			b: ['b'],
			set: (b, v) => b.services([v[0] === 'a' ? serviceA : serviceB]),
			get: (q) => names(q.services),
		},
		{
			name: 'dependsOn',
			a: ['Uploads'],
			b: ['Emails'],
			set: (b, v) => b.dependsOn([v[0] === 'Uploads' ? uploads : emails]),
			get: (q) => q.constructs,
		},
	] as Field<any>[],
);

reusable(
	'SubscriberBuilder',
	() => new SubscriberBuilder(),
	(b) => b.handle(async () => null),
	[
		{
			name: 'topic',
			a: 'alpha',
			b: 'beta',
			set: (b, v) => b.topic(v === 'alpha' ? topicA : topicB),
			get: (s) => s.topicName,
		},
		{
			name: 'timeout',
			a: 1000,
			b: 2000,
			set: (b, v) => b.timeout(v),
			get: (s) => s.timeout,
		},
		{
			name: 'output',
			a: schemaA,
			b: schemaB,
			set: (b, v) => b.output(v),
			get: (s) => s.outputSchema,
		},
		{
			name: 'logger',
			a: loggerA,
			b: loggerB,
			set: (b, v) => b.logger(v),
			get: (s) => s.logger,
		},
		{
			name: 'publisher',
			a: publisherA,
			b: publisherB,
			set: (b, v) => b.publisher(v),
			get: (s) => s.publisherService,
		},
		{
			name: 'services',
			a: ['a'],
			b: ['b'],
			set: (b, v) => b.services([v[0] === 'a' ? serviceA : serviceB]),
			get: (s) => names(s.services),
		},
		{
			name: 'dependsOn',
			a: ['Uploads'],
			b: ['Emails'],
			set: (b, v) => b.dependsOn([v[0] === 'Uploads' ? uploads : emails]),
			get: (s) => s.constructs,
		},
	] as Field<any>[],
);

// Found last, and it had both bugs untouched: `t` is a module singleton that
// mutated and reset, so a configured base lasted one topic and two chains off
// one base shared an object. It is a builder like any other; it was simply
// missed when the others were enumerated.
reusable(
	'TopicBuilder',
	// `.events()` is the terminal call and needs a name, so the base carries one.
	() => new TopicBuilder().topic('base'),
	(b) => b.events({ 'a.one': z.object({}) }),
	[
		{
			name: 'topic',
			a: 'alpha',
			b: 'beta',
			set: (b, v) => b.topic(v),
			get: (t) => t.name,
		},
		{
			name: 'logger',
			a: loggerA,
			b: loggerB,
			set: (b, v) => b.logger(v),
			get: (t) => t.logger,
		},
	] as Field<any>[],
);
