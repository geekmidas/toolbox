import { realpathSync } from 'node:fs';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	minioTargetArn,
	minioWebhookEnv,
	objectsWebhookToken,
	watchedBuckets,
} from '../objectEvents';
import { localObjectWebhooks } from '../workspace';

const UPLOADS = {
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	Reports: { kind: 'objects', id: 'Reports', provides: ['REPORTS_URL'] },
} as unknown as ConstructManifest;

describe('which buckets are watched', () => {
	it('is each bucket a subscriber reads the events of, run by the first worker by id', () => {
		const watched = watchedBuckets(UPLOADS, {
			Thumbnails: [
				{ name: 'onAvatar', connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING' },
			],
			Archive: [
				{ name: 'onUpload', connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING' },
				// A topic's subscriber watches no bucket.
				{
					name: 'onAlert',
					connectionKey: 'ALERTS_PUBLISHER_CONNECTION_STRING',
				},
			],
		});

		expect([...watched]).toEqual([['Uploads', 'Archive']]);
	});
});

describe("MinIO's webhook targets", () => {
	it('declares one per bucket, sorted, with a queue for what it cannot deliver yet', () => {
		expect(
			minioWebhookEnv([
				{ bucket: 'Uploads', endpoint: 'http://jobs:3000/u', token: 't1' },
				{ bucket: 'Reports', endpoint: 'http://jobs:3000/r', token: 't2' },
			]),
		).toEqual({
			MINIO_NOTIFY_WEBHOOK_ENABLE_REPORTS: 'on',
			MINIO_NOTIFY_WEBHOOK_ENDPOINT_REPORTS: 'http://jobs:3000/r',
			MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_REPORTS: 't2',
			MINIO_NOTIFY_WEBHOOK_QUEUE_DIR_REPORTS: '/gkm-object-events/reports',
			MINIO_NOTIFY_WEBHOOK_ENABLE_UPLOADS: 'on',
			MINIO_NOTIFY_WEBHOOK_ENDPOINT_UPLOADS: 'http://jobs:3000/u',
			MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_UPLOADS: 't1',
			MINIO_NOTIFY_WEBHOOK_QUEUE_DIR_UPLOADS: '/gkm-object-events/uploads',
		});
	});

	it('names a target with no separator inside its id', () => {
		// An underscore would read as part of the setting's name.
		expect(minioTargetArn('UserUploads')).toBe(
			'arn:minio:sqs::USERUPLOADS:webhook',
		);
	});

	it('derives a token per bucket, secret where there is a seed', () => {
		const local = objectsWebhookToken('shop', 'Uploads');

		expect(local).toMatch(/^[\w-]{32}$/);
		expect(objectsWebhookToken('shop', 'Uploads')).toBe(local);
		expect(objectsWebhookToken('shop', 'Reports')).not.toBe(local);
		expect(objectsWebhookToken('shop', 'Uploads', 'seed')).not.toBe(local);
	});
});

describe('where MinIO posts under gkm dev', () => {
	let dir: string;
	let workspace: NormalizedWorkspace;
	let manifest: ConstructManifest;
	let background: Record<string, string[]>;

	beforeAll(async () => {
		dir = realpathSync(await createTempDir('gkm-object-events-'));
		writeComposeApp(dir, {});
		({ workspace, manifest, background } = await loadComposeApp(dir));
	});
	afterAll(async () => {
		await cleanupDir(dir);
	});

	const subscribers = {
		Jobs: [
			{ name: 'onAvatar', connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING' },
		],
	};

	it('is the dev server of the app that builds the worker, on the host', () => {
		const hooks = localObjectWebhooks(
			workspace,
			{ ...manifest, ...UPLOADS } as ConstructManifest,
			{ background, subscribers, seed: 'local-seed' },
		);
		const port = workspace.apps.api!.port;

		expect(hooks).toEqual([
			{
				bucket: 'Uploads',
				endpoint: `http://host.docker.internal:${port}/__gkm/objects/Uploads`,
				token: objectsWebhookToken(workspace.name, 'Uploads', 'local-seed'),
			},
		]);
	});

	it('is nowhere when nothing watches a bucket, or its events come from SNS', () => {
		const withBuckets = { ...manifest, ...UPLOADS } as ConstructManifest;

		expect(
			localObjectWebhooks(workspace, withBuckets, {
				background,
				subscribers: {},
			}),
		).toEqual([]);
		expect(
			localObjectWebhooks(
				// SST deploys to AWS, whose broker is SNS.
				{ ...workspace, deploy: { ...workspace.deploy, default: 'sst' } },
				withBuckets,
				{ background, subscribers },
			),
		).toEqual([]);
	});

	it('is nowhere for a worker no app builds', () => {
		expect(
			localObjectWebhooks(
				workspace,
				{ ...manifest, ...UPLOADS } as ConstructManifest,
				{ background: {}, subscribers },
			),
		).toEqual([]);
	});
});
