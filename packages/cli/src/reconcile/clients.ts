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
	HeadBucketCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { Client } from 'pg';
import type { BucketClient, SqlClient } from './provision';

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
	};
}
