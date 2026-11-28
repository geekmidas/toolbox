import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect } from 'vitest';
import { CronGenerator } from '../CronGenerator';
import { SubscriberGenerator } from '../SubscriberGenerator';

/**
 * `worker.webhooks(hooks)` returns its two runnables together, and an app
 * exports them by destructuring. Discovery only finds exported runnables, so
 * each has to be found under the name it was exported as.
 */
describe('worker.webhooks() exported by destructuring', () => {
	itWithDir(
		'finds the deliverer and the sweep under their exported names',
		async ({ dir }) => {
			await writeFile(
				join(dir, 'webhooks.ts'),
				`
import { z } from 'zod/v4';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { Encryption } from '@geekmidas/constructs/encryption';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { Topic } from '@geekmidas/constructs/topic';
import { Worker } from '@geekmidas/constructs/worker';

const billing = new Topic('Billing', {
  events: { 'invoice.paid': z.object({ invoiceId: z.string() }) },
});
const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
const worker = new Worker('Jobs');

export const billingHooks = api.webhooks('BillingHooks', {
  topic: billing,
  database: new KyselyDatabase('App').schema('BillingHooksDb'),
  encryption: new Encryption('Pii'),
});

export const { deliver: deliverBilling, sweep: retryBilling } =
  worker.webhooks(billingHooks, { sweep: 'rate(5 minutes)' });
`,
			);
			const patterns = join(dir, '**/*.ts');

			const subscribers = await new SubscriberGenerator().load(patterns);
			const crons = await new CronGenerator().load(patterns);

			expect(subscribers.map(({ key }) => key)).toEqual(['deliverBilling']);
			expect(subscribers[0]?.construct.topicName).toBe('Billing');
			expect(crons.map(({ key }) => key)).toEqual(['retryBilling']);
			expect(crons[0]?.construct.schedule).toBe('rate(5 minutes)');
		},
	);
});
