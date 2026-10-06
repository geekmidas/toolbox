/**
 * The StateStore conformance suite, against every built-in store.
 *
 * SSM and S3 run against the local AWS emulator (floci, LocalStack-
 * compatible), which honours SSM parameter versions and create-if-absent
 * puts, and S3 `If-Match` / `If-None-Match` — so the conditional writes
 * under test are the server's, not a mock's.
 *
 * Requires the emulator: docker compose up -d localstack
 */

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CreateBucketCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import {
	GetParameterCommand,
	PutParameterCommand,
	SSMClient,
} from '@aws-sdk/client-ssm';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { LocalStateStore } from '../LocalStateStore';
import { S3StateStore } from '../S3StateStore';
import { SSMStateStore } from '../SSMStateStore';
import { stateStoreConformance } from './__helpers__/stateStoreConformance';

const aws = {
	region: 'us-east-1',
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};

stateStoreConformance('LocalStateStore', async () => {
	const root = await mkdtemp(join(tmpdir(), 'gkm-state-store-'));
	const store = new LocalStateStore(root);
	return {
		open: () => new LocalStateStore(root),
		seedV1: async (stage, body) => {
			await mkdir(join(root, '.gkm'), { recursive: true });
			await writeFile(store.statePath(stage), body);
		},
		readV1Backup: (stage) =>
			readFile(store.backupPath(stage), 'utf-8').catch(() => null),
	};
});

stateStoreConformance('SSMStateStore', async () => {
	// Its own workspace per run, so leftovers from an earlier run (the
	// emulator outlives the suite) are never read.
	const workspaceName = `conformance-${randomUUID().slice(0, 8)}`;
	const client = new SSMClient(aws);
	const name = (stage: string, leaf: string) =>
		`/gkm/${workspaceName}/${stage}/${leaf}`;
	return {
		open: () => new SSMStateStore(workspaceName, new SSMClient(aws)),
		seedV1: async (stage, body) => {
			await client.send(
				new PutParameterCommand({
					Name: name(stage, 'state'),
					Value: body,
					Type: 'SecureString',
				}),
			);
		},
		readV1Backup: async (stage) => {
			const { Parameter } = await client
				.send(
					new GetParameterCommand({
						Name: name(stage, 'state.v1'),
						WithDecryption: true,
					}),
				)
				.catch(() => ({ Parameter: undefined }));
			return Parameter?.Value ?? null;
		},
	};
});

stateStoreConformance('S3StateStore', async () => {
	const s3 = { ...aws, forcePathStyle: true };
	const bucket = `gkm-state-${randomUUID().slice(0, 8)}`;
	const client = new S3Client(s3);
	await client.send(new CreateBucketCommand({ Bucket: bucket }));
	const workspaceName = 'conformance';
	const key = (stage: string, leaf: string) =>
		`gkm/${workspaceName}/${stage}/${leaf}`;
	return {
		open: () => new S3StateStore(workspaceName, bucket, new S3Client(s3)),
		seedV1: async (stage, body) => {
			await client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key(stage, 'state.json'),
					Body: body,
				}),
			);
		},
		readV1Backup: async (stage) => {
			try {
				const { Body } = await client.send(
					new GetObjectCommand({
						Bucket: bucket,
						Key: key(stage, 'state.v1.json'),
					}),
				);
				return (await Body?.transformToString('utf-8')) ?? null;
			} catch {
				return null;
			}
		},
	};
});
