// Type-level check that Queue/Topic are linkables whose publisher connection
// strings validate. Checked by `ts:check:sst`; vitest ignores it.

import { App } from '../App';
import { Function } from '../aws/Function';
import { Queue } from '../aws/Queue';
import { Topic } from '../aws/Topic';

const stack = new App({
	name: 'shop',
	stage: 'dev',
	domain: 'example.com',
	hostedZoneId: 'Z',
	region: 'us-east-1',
}).stack('events');

const orders = new Queue(stack, 'orders');
const events = new Topic(stack, 'events');

// A producer linked to both resolves each resource's publisher connection
// string (namespaced by name) — env validation passes for both.
export const producer = new Function(stack, 'Producer', {
	handler: 'producer.handler',
	links: [orders, events],
	envVars: [
		'ORDERS_PUBLISHER_CONNECTION_STRING',
		'EVENTS_PUBLISHER_CONNECTION_STRING',
	],
});
