import * as CF from '@aws-sdk/client-cloudfront';
import {
	CloudFrontClient,
	CreateOriginAccessControlCommand,
	CreateResponseHeadersPolicyCommand,
	DeleteOriginAccessControlCommand,
	DeleteResponseHeadersPolicyCommand,
	GetOriginAccessControlCommand,
	GetResponseHeadersPolicyConfigCommand,
} from '@aws-sdk/client-cloudfront';
import {
	CreateUserCommand,
	DeleteUserCommand,
	IAMClient,
} from '@aws-sdk/client-iam';
import {
	CreateBucketCommand,
	DeleteBucketCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import {
	CreateTopicCommand,
	DeleteTopicCommand,
	GetTopicAttributesCommand,
	SNSClient,
	SubscribeCommand,
} from '@aws-sdk/client-sns';
import {
	CreateQueueCommand,
	DeleteQueueCommand,
	GetQueueAttributesCommand,
	GetQueueUrlCommand,
	SQSClient,
} from '@aws-sdk/client-sqs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import type { ResourceRecord } from '../../deploy/StateStore';
import { TAG_PROJECT, TAG_STAGE } from '../iam';
import type { CdnClients } from '../s3/cdn';
import { cdnName } from '../s3/cdn';
import { DistributionStillDeploying, planAwsDestroy } from '../s3/destroy';

/**
 * What `planAwsDestroy` decides about each record, against the AWS emulator
 * (floci) with resources made here: deleted when gkm's mark is on it, left
 * alone when it is not, forgotten when it is already gone.
 */

const REGION = 'eu-west-1';
const STAGE = 'prod';
const admin = {
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
	region: REGION,
};
const s3 = new S3Client({ ...admin, forcePathStyle: true });
const iam = new IAMClient(admin);
const sns = new SNSClient(admin);
const sqs = new SQSClient(admin);
const cloudfront = new CloudFrontClient({ ...admin, region: 'us-east-1' });

const run = `plan-${Date.now().toString(36)}`;
const identityKey = `${run}/${run}`;
const tags = [
	{ Key: TAG_PROJECT, Value: identityKey },
	{ Key: TAG_STAGE, Value: STAGE },
];

const record = (
	key: string,
	type: string,
	id: string,
	data?: Record<string, unknown>,
): ResourceRecord => ({
	key,
	type,
	id,
	status: 'ready',
	...(data ? { data } : {}),
	updatedAt: new Date(0).toISOString(),
});

const resources = (...records: ResourceRecord[]) =>
	Object.fromEntries(records.map((r) => [r.key, r]));

const plan = (records: ResourceRecord[]) =>
	planAwsDestroy({
		resources: resources(...records),
		identityKey,
		scope: run,
		stage: STAGE,
		credential: { chain: true, region: REGION },
	});

const missing = (send: Promise<unknown>) =>
	send.then(
		() => false,
		() => true,
	);

beforeAll(() => {
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);
});

afterAll(() => {
	vi.unstubAllEnvs();
});

describe('planAwsDestroy', { timeout: 60_000 }, () => {
	it("deletes a stage's topic, queue and subscription, and leaves untagged ones", async () => {
		const topic = await sns.send(
			new CreateTopicCommand({ Name: `${run}-events`, Tags: tags }),
		);
		const other = await sns.send(
			new CreateTopicCommand({ Name: `${run}-someone-elses` }),
		);
		const queue = await sqs.send(
			new CreateQueueCommand({
				QueueName: `${run}-dlq`,
				tags: Object.fromEntries(tags.map((t) => [t.Key, t.Value])),
			}),
		);
		const otherQueue = await sqs.send(
			new CreateQueueCommand({ QueueName: `${run}-theirs` }),
		);
		const arnOf = async (url: string) =>
			(
				await sqs.send(
					new GetQueueAttributesCommand({
						QueueUrl: url,
						AttributeNames: ['QueueArn'],
					}),
				)
			).Attributes?.QueueArn ?? '';
		const queueArn = await arnOf(queue.QueueUrl!);
		const otherArn = await arnOf(otherQueue.QueueUrl!);
		const subscription = await sns.send(
			new SubscribeCommand({
				TopicArn: topic.TopicArn,
				Protocol: 'sqs',
				Endpoint: queueArn,
				ReturnSubscriptionArn: true,
			}),
		);

		try {
			const { steps } = await plan([
				record(
					'sns-subscription:jobs/uploads',
					'sns-subscription',
					subscription.SubscriptionArn!,
				),
				record('sns-subscription:jobs/later', 'sns-subscription', 'pending'),
				record('sns-topic:Uploads', 'sns-topic', topic.TopicArn!),
				record('sns-topic:Theirs', 'sns-topic', other.TopicArn!),
				record('sqs-queue:Uploads-events-dlq', 'sqs-queue', queueArn),
				record('sqs-queue:Theirs', 'sqs-queue', otherArn),
			]);
			const by = (key: string) => steps.find((s) => s.key === key)!;

			expect(by('sns-subscription:jobs/later').gone).toBe(true);
			expect(by('sns-topic:Theirs').leftAlone).toMatch(/not tagged/);
			expect(by('sqs-queue:Theirs').leftAlone).toMatch(/not tagged/);
			for (const step of steps) await step.remove?.();

			expect(
				await missing(
					sns.send(new GetTopicAttributesCommand({ TopicArn: topic.TopicArn })),
				),
			).toBe(true);
			expect(
				await missing(
					sqs.send(new GetQueueUrlCommand({ QueueName: `${run}-dlq` })),
				),
			).toBe(true);
			expect(
				await missing(
					sns.send(new GetTopicAttributesCommand({ TopicArn: other.TopicArn })),
				),
			).toBe(false);
		} finally {
			const ignore = () => {};
			await sns
				.send(new DeleteTopicCommand({ TopicArn: other.TopicArn }))
				.catch(ignore);
			await sqs
				.send(new DeleteQueueCommand({ QueueUrl: otherQueue.QueueUrl }))
				.catch(ignore);
		}
	});

	it('forgets a record whose resource is already gone, of every type', async () => {
		const account = '000000000000';
		const { steps } = await plan([
			record(
				'cloudfront-distribution:Gone',
				'cloudfront-distribution',
				'E0000GONE0000',
			),
			record('cloudfront-oac:Gone', 'cloudfront-oac', 'E0000GONE0001'),
			record(
				'cloudfront-headers:Gone:cors',
				'cloudfront-headers',
				'00000000-0000-0000-0000-000000000000',
			),
			record(
				'acm-certificate:Gone',
				'acm-certificate',
				`arn:aws:acm:us-east-1:${account}:certificate/00000000-0000-0000-0000-000000000000`,
				{ host: 'gone.example.com' },
			),
			record(
				'sns-topic:Gone',
				'sns-topic',
				`arn:aws:sns:${REGION}:${account}:${run}-gone`,
			),
			record(
				'sqs-queue:Gone',
				'sqs-queue',
				`arn:aws:sqs:${REGION}:${account}:${run}-gone`,
			),
			record('iam-user:Gone', 'iam-user', `${run}-gone`),
			record('s3-bucket:Gone', 's3-bucket', `${run}-gone`, { region: REGION }),
		]);

		expect(steps.map((s) => [s.key, s.gone === true])).toEqual(
			steps.map((s) => [s.key, true]),
		);
	});

	it('leaves an untagged bucket and user, and the keys of a user it leaves', async () => {
		const bucket = `${run}-found`;
		const user = `${run}-found`;
		await s3.send(new CreateBucketCommand({ Bucket: bucket }));
		await iam.send(new CreateUserCommand({ UserName: user, Path: '/gkm/' }));
		try {
			const { steps } = await plan([
				record('iam-user:Found', 'iam-user', user),
				record('iam-access-key:Found', 'iam-access-key', 'AKIAFOUND', { user }),
				record('iam-access-key:Stray', 'iam-access-key', 'AKIASTRAY', {
					user: `${run}-never-recorded`,
				}),
				record('s3-bucket:Found', 's3-bucket', bucket, { region: REGION }),
			]);
			const by = (key: string) => steps.find((s) => s.key === key)!;

			expect(by('iam-user:Found').leftAlone).toMatch(/not tagged/);
			expect(by('iam-access-key:Found').leftAlone).toMatch(
				/its user is left alone/,
			);
			expect(by('iam-access-key:Stray').leftAlone).toMatch(
				/not one this stage recorded/,
			);
			expect(by('s3-bucket:Found').leftAlone).toMatch(/not tagged/);
			expect(steps.some((s) => s.remove)).toBe(false);
		} finally {
			await s3
				.send(new DeleteBucketCommand({ Bucket: bucket }))
				.catch(() => {});
			await iam.send(new DeleteUserCommand({ UserName: user })).catch(() => {});
		}
	});

	it("leaves an origin access control or headers policy not named as the stage's", async () => {
		const oac = await cloudfront.send(
			new CreateOriginAccessControlCommand({
				OriginAccessControlConfig: {
					Name: `${run}-someone-elses`,
					OriginAccessControlOriginType: 's3',
					SigningBehavior: 'always',
					SigningProtocol: 'sigv4',
				},
			}),
		);
		const policy = await cloudfront.send(
			new CreateResponseHeadersPolicyCommand({
				ResponseHeadersPolicyConfig: {
					Name: `${run}-someone-elses`,
					CustomHeadersConfig: {
						Quantity: 1,
						Items: [{ Header: 'X-Theirs', Value: '1', Override: true }],
					},
				},
			}),
		);
		const oacId = oac.OriginAccessControl!.Id!;
		const policyId = policy.ResponseHeadersPolicy!.Id!;
		try {
			const { steps } = await plan([
				record('cloudfront-oac:UploadsServer', 'cloudfront-oac', oacId),
				record(
					'cloudfront-headers:UploadsServer:cors',
					'cloudfront-headers',
					policyId,
				),
			]);
			const expected = cdnName(run, STAGE, 'UploadsServer');

			expect(steps.map((s) => s.leftAlone)).toEqual([
				`named ${run}-someone-elses, not this stage's ${expected}`,
				`named ${run}-someone-elses, not this stage's ${expected}-cors`,
			]);
		} finally {
			const { ETag: oacTag } = await cloudfront.send(
				new GetOriginAccessControlCommand({ Id: oacId }),
			);
			await cloudfront
				.send(
					new DeleteOriginAccessControlCommand({ Id: oacId, IfMatch: oacTag }),
				)
				.catch(() => {});
			const { ETag: policyTag } = await cloudfront.send(
				new GetResponseHeadersPolicyConfigCommand({ Id: policyId }),
			);
			await cloudfront
				.send(
					new DeleteResponseHeadersPolicyCommand({
						Id: policyId,
						IfMatch: policyTag,
					}),
				)
				.catch(() => {});
		}
	});

	it('stops, by name, on a distribution that never finishes deploying', async () => {
		const id = 'E0000DEPLOYING';
		const comment = `gkm ${identityKey} ${STAGE} UploadsServer`;
		// CloudFront as it is while a distribution is still being disabled.
		const deploying = {
			send: async (command: object) => {
				if (command instanceof CF.GetDistributionCommand) {
					return {
						Distribution: {
							Id: id,
							ARN: `arn:aws:cloudfront::000000000000:distribution/${id}`,
							DomainName: 'd0000.cloudfront.net',
							Status: 'InProgress',
							DistributionConfig: {
								Comment: comment,
								Aliases: { Quantity: 1, Items: ['uploads.example.com'] },
							},
						},
					};
				}
				if (command instanceof CF.ListTagsForResourceCommand) {
					return { Tags: { Items: [] } };
				}
				if (command instanceof CF.GetDistributionConfigCommand) {
					return { ETag: 'E1', DistributionConfig: { Enabled: false } };
				}
				throw new Error(`not expected: ${command.constructor.name}`);
			},
		};
		const { steps, dns } = await planAwsDestroy({
			resources: resources(
				record(
					'cloudfront-distribution:UploadsServer',
					'cloudfront-distribution',
					id,
				),
			),
			identityKey,
			scope: run,
			stage: STAGE,
			credential: { chain: true, region: REGION },
			wait: { timeoutMs: 0, intervalMs: 1 },
			clients: {
				cdn: async () =>
					({ CF, cloudfront: deploying }) as unknown as CdnClients,
			},
		});

		expect(dns).toEqual([
			{
				host: 'uploads.example.com',
				type: 'CNAME',
				value: 'd0000.cloudfront.net',
			},
		]);
		await expect(steps[0]!.remove!()).rejects.toBeInstanceOf(
			DistributionStillDeploying,
		);
	});
});
