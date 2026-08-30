import { defineConfig } from 'tsdown';

export default defineConfig({
	// Explicit, because the URL codecs need their own entry points: a deploy
	// config composes a connection string and must not have to resolve the AWS
	// SDK the publisher beside them imports.
	entry: [
		'src/index.ts',
		'src/basic/index.ts',
		'src/rabbitmq/index.ts',
		'src/sqs/index.ts',
		'src/sqs/sqsUrl.ts',
		'src/sns/index.ts',
		'src/sns/snsUrl.ts',
		'src/pgboss/index.ts',
	],
	external: [
		'amqplib',
		'@aws-sdk/client-sqs',
		'@aws-sdk/client-sns',
		'pg-boss',
	],
});
