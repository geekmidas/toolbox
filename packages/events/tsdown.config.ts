import { defineConfig } from 'tsdown';

export default defineConfig({
	// Explicit, because the URL codecs need their own entry points: a deploy
	// config composes a connection string and must not have to resolve the AWS
	// SDK the publisher beside them imports. `sns/message` is the same for a
	// server that receives SNS pushes: verifying one takes no SDK.
	entry: [
		'src/index.ts',
		'src/basic/index.ts',
		'src/rabbitmq/index.ts',
		'src/sqs/index.ts',
		'src/sqs/sqsUrl.ts',
		'src/sns/index.ts',
		'src/sns/message.ts',
		'src/sns/snsUrl.ts',
		'src/pgboss/index.ts',
	],
	deps: {
		neverBundle: [
			'amqplib',
			'@aws-sdk/client-sqs',
			'@aws-sdk/client-sns',
			'pg-boss',
		],
	},
});
