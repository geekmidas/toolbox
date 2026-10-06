import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'events',
		// pg-boss, SNS/SQS and RabbitMQ are each tested against the real broker,
		// started from the root `docker-compose.yml` if it is not already up.
		globalSetup: ['../testkit/test/eventsSetup.ts'],
	},
});
