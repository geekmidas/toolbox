import { ensureServices } from './services';

/**
 * Every broker `@geekmidas/events` speaks to: pg-boss's Postgres, the AWS
 * emulator for SNS and SQS, and RabbitMQ. Started here like every other
 * suite's services, so a missing broker is a container that comes up rather
 * than a spec that fails with a connection refused.
 */
export default async function globalSetup() {
	await ensureServices('postgres', 'localstack', 'rabbitmq');
}
