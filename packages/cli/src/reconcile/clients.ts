/**
 * The real Postgres and MinIO clients the applier runs against.
 *
 * Kept apart from `provision.ts` so the rules there — what gets created, in what
 * order, and never dropping anything — are asserted against fakes, while the
 * drivers live here where there is nothing to assert but wiring.
 *
 * Both are constructed from the same local addresses the env writer composes,
 * so the applier cannot end up talking to a different container than the app.
 */

import {
	CreateBucketCommand,
	GetBucketPolicyCommand,
	HeadBucketCommand,
	PutBucketPolicyCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import {
	CreateTopicCommand,
	GetTopicAttributesCommand,
	SNSClient,
} from '@aws-sdk/client-sns';
import {
	CreateQueueCommand,
	GetQueueUrlCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import { Client } from 'pg';
import {
	EMULATOR_CREDENTIALS,
	EMULATOR_REGION,
	emulatorEndpoint,
	emulatorTopicArn,
} from './emulator';
import type { BucketClient, CarrierClient, SqlClient } from './provision';

/** The credential local containers are brought up with. */
const LOCAL_USER = 'geekmidas';

/**
 * A Postgres client that opens one connection per database it is asked about.
 *
 * `CREATE DATABASE` cannot run from a connection to the database being created,
 * and a schema must be created from inside its own database — so the database is
 * part of each query rather than fixed when the client is built.
 */
export function pgClient(port: number): SqlClient {
	return {
		async query(database, sql, values) {
			const client = new Client({
				host: 'localhost',
				port,
				user: LOCAL_USER,
				password: LOCAL_USER,
				// The cluster's own database, which the image creates. Connecting to
				// it is what makes `CREATE DATABASE` possible at all.
				database: database ?? LOCAL_USER,
			});

			await client.connect();
			try {
				const result = await client.query(sql, values as never[]);
				return result.rows;
			} finally {
				await client.end();
			}
		},
	};
}

/** A bucket client pointed at the local MinIO. */
export function bucketClient(port: number): BucketClient {
	const s3 = new S3Client({
		region: 'us-east-1',
		endpoint: `http://localhost:${port}`,
		// MinIO serves buckets as paths, not as subdomains of the endpoint.
		forcePathStyle: true,
		credentials: { accessKeyId: LOCAL_USER, secretAccessKey: LOCAL_USER },
	});

	return {
		async exists(bucket) {
			try {
				await s3.send(new HeadBucketCommand({ Bucket: bucket }));
				return true;
			} catch {
				// Missing, or not reachable. Creating is idempotent enough that
				// treating both as "missing" is safe.
				return false;
			}
		},

		async create(bucket) {
			await s3.send(new CreateBucketCommand({ Bucket: bucket }));
		},

		async policy(bucket) {
			try {
				const result = await s3.send(
					new GetBucketPolicyCommand({ Bucket: bucket }),
				);
				return result.Policy;
			} catch {
				// No policy, or the bucket is not reachable. Both mean there is
				// nothing to compare against, and writing one is idempotent.
				return undefined;
			}
		},

		async setPolicy(bucket, policy) {
			await s3.send(
				new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }),
			);
		},
	};
}

/** A topic and queue client pointed at the local AWS emulator. */
export function carrierClient(port: number): CarrierClient {
	const config = {
		region: EMULATOR_REGION,
		endpoint: emulatorEndpoint(port),
		credentials: EMULATOR_CREDENTIALS,
	};
	const sns = new SNSClient(config);
	const sqs = new SQSClient(config);

	return {
		async topicExists(name) {
			try {
				await sns.send(
					new GetTopicAttributesCommand({ TopicArn: emulatorTopicArn(name) }),
				);
				return true;
			} catch {
				// Missing, or not reachable; creating is idempotent either way.
				return false;
			}
		},

		async createTopic(name) {
			await sns.send(new CreateTopicCommand({ Name: name }));
		},

		async queueExists(name) {
			try {
				await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
				return true;
			} catch {
				return false;
			}
		},

		async createQueue(name) {
			await sqs.send(new CreateQueueCommand({ QueueName: name }));
		},
	};
}
