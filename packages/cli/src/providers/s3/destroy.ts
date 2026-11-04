/**
 * What `gkm compose --destroy` deletes in the stage's AWS account: each
 * resource a deploy recorded in the stage's state, and only once it is
 * proven gkm's own for this stage.
 *
 * A record alone proves nothing — a deploy records what it found and adopted
 * exactly as what it made (a certificate for the host, a bucket with no
 * tags). So each is checked against what gkm marks its own with: the
 * `gkm:project` and `gkm:stage` tags on a bucket, a user, a certificate, a
 * distribution, a topic or a queue; the stage's own name on an origin access
 * control and a headers policy, which take no tags. What fails the check is
 * left where it is, and said so.
 *
 * Nothing here runs on its own: `planAwsDestroy` reads, and returns a step
 * per resource whose `remove()` the command calls — after the person typed
 * the stage's name — in the order AWS needs: a distribution disabled and
 * gone before its certificate, a user's keys and policies before the user,
 * a bucket emptied before it is deleted.
 */

import type { ResourceRecord } from '../../deploy/StateStore.js';
import { GkmError } from '../../errors.js';
import { type AwsProvisioning, awsClientConfig, awsEndpoint } from '../aws.js';
import { TAG_PROJECT, TAG_STAGE } from '../iam.js';
import { type CdnClients, cdnName, defaultCdnClients } from './cdn.js';
import { defaultClients } from './index.js';
import { IAM_USER_PATH } from './naming.js';

/** What a destroy step is about, as the person reads it. */
export interface AwsDestroyStep {
	/** The state record it is kept as: forgotten once it is gone. */
	key: string;
	label: string;
	/** Why it is not deleted. Absent for one that will be. */
	leftAlone?: string;
	/** Already gone from the account: only its record is forgotten. */
	gone?: boolean;
	/** Deletes it. Absent when it is left alone or already gone. */
	remove?: () => Promise<void>;
}

/** A DNS record a resource here needs, worked out from the resource. */
export interface AwsDnsRecord {
	host: string;
	type: 'CNAME';
	value: string;
}

export interface AwsDestroyPlan {
	/** In the order they are removed. */
	steps: AwsDestroyStep[];
	/**
	 * The records the s3 provider wrote for what it deletes — a CDN's name, a
	 * certificate's validation — which no state record names.
	 */
	dns: AwsDnsRecord[];
}

export interface AwsDestroyInput {
	resources: Record<string, ResourceRecord>;
	/** `deployIdentity(…).key` — what `gkm:project` holds. */
	identityKey: string;
	/** `deployIdentity(…).scope` — what CDN resource names start with. */
	scope: string;
	stage: string;
	credential: AwsProvisioning;
	/** How long a disabled distribution is waited on, and how often asked. */
	wait?: { timeoutMs: number; intervalMs: number };
	/** For tests: where the clients come from. */
	clients?: {
		s3?: typeof defaultClients;
		cdn?: (credential: AwsProvisioning) => Promise<CdnClients>;
	};
}

/** The record types this plans. Every other is the command's to report. */
export const AWS_RESOURCE_TYPES = [
	'cloudfront-distribution',
	'cloudfront-oac',
	'cloudfront-headers',
	'acm-certificate',
	'sns-subscription',
	'sns-topic',
	'sqs-queue',
	'iam-access-key',
	'iam-user',
	's3-bucket',
] as const;

/** A distribution disabled before it is deleted can take this long. */
const DISABLE_WAIT = { timeoutMs: 45 * 60_000, intervalMs: 20_000 };

/** A disabled distribution that never finished deploying. */
export class DistributionStillDeploying extends GkmError {
	constructor(
		readonly id: string,
		readonly waitedMs: number,
	) {
		super(
			`CloudFront distribution ${id} was disabled, and is still deploying after ` +
				`${Math.round(waitedMs / 60_000)} minutes. CloudFront deletes only a ` +
				'disabled distribution that has finished deploying. Run the destroy ' +
				'again later: everything deleted so far is forgotten, and it carries ' +
				'on from here.',
		);
		this.name = 'DistributionStillDeploying';
	}
}

/** What an AWS SDK error is called, whichever field carries it. */
function errorName(error: unknown): string {
	const e = error as { name?: string; Code?: string };
	return e?.Code ?? e?.name ?? '';
}

/** A read whose "there is none" answer is one of `missing`. */
async function readOr<T>(
	read: () => Promise<T>,
	missing: readonly string[],
): Promise<T | undefined> {
	try {
		return await read();
	} catch (error) {
		if (missing.includes(errorName(error))) return undefined;
		throw error;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whether a tag list says gkm made it for this project's stage. */
function ours(
	tags: readonly { Key?: string; Value?: string }[] | undefined,
	input: Pick<AwsDestroyInput, 'identityKey' | 'stage'>,
): boolean {
	const of = (key: string) => tags?.find((t) => t.Key === key)?.Value;
	return of(TAG_PROJECT) === input.identityKey && of(TAG_STAGE) === input.stage;
}

const NOT_TAGGED =
	"not tagged as this stage's (gkm:project, gkm:stage): gkm found it, it did not make it";

/** The id after the type in a record's key: `cloudfront-oac:Uploads` → `Uploads`. */
function keyId(record: ResourceRecord): string {
	return record.key.slice(record.key.indexOf(':') + 1);
}

/** The file server a CDN record is for: `cloudfront-headers:Uploads:cors` → `Uploads`. */
function serverOf(record: ResourceRecord): string {
	return keyId(record).split(':')[0] ?? '';
}

/**
 * Each AWS resource the stage's state records, checked, in the order it is
 * deleted — and the DNS records the deleted ones were given.
 */
export async function planAwsDestroy(
	input: AwsDestroyInput,
): Promise<AwsDestroyPlan> {
	const steps: AwsDestroyStep[] = [];
	const dns: AwsDnsRecord[] = [];
	const records = Object.values(input.resources);
	const of = (type: string) => records.filter((r) => r.type === type);
	const wait = input.wait ?? DISABLE_WAIT;

	const cdnRecords = [
		...of('cloudfront-distribution'),
		...of('cloudfront-oac'),
		...of('cloudfront-headers'),
		...of('acm-certificate'),
	];
	if (cdnRecords.length > 0) {
		const cdn = await (input.clients?.cdn ?? defaultCdnClients)(
			input.credential,
		);
		// A distribution left alone keeps what it uses: deleting its origin
		// access control, a headers policy or its certificate would break it.
		const kept = new Map<string, string>();
		for (const record of of('cloudfront-distribution')) {
			const step = await distributionStep(cdn, record, input, wait, dns);
			if (step.leftAlone) kept.set(serverOf(record), step.label);
			steps.push(step);
		}
		const usedBy = async (
			record: ResourceRecord,
			step: () => Promise<AwsDestroyStep>,
		): Promise<AwsDestroyStep> => {
			const holder = kept.get(serverOf(record));
			if (!holder) return step();
			const label = (await step()).label;
			return {
				key: record.key,
				label,
				leftAlone: `used by ${holder}, which is left alone`,
			};
		};
		for (const record of of('cloudfront-oac')) {
			steps.push(
				await usedBy(record, () => originAccessControlStep(cdn, record, input)),
			);
		}
		for (const record of of('cloudfront-headers')) {
			steps.push(
				await usedBy(record, () => headersPolicyStep(cdn, record, input)),
			);
		}
		for (const record of of('acm-certificate')) {
			// Its validation record goes only with the certificate itself.
			const found: AwsDnsRecord[] = [];
			const step = await usedBy(record, () =>
				certificateStep(cdn, record, input, found),
			);
			if (!step.leftAlone) dns.push(...found);
			steps.push(step);
		}
	}

	const eventRecords = [
		...of('sns-subscription'),
		...of('sns-topic'),
		...of('sqs-queue'),
	];
	if (eventRecords.length > 0) {
		const events = await eventClients(input.credential, records);
		for (const record of of('sns-subscription')) {
			steps.push(subscriptionStep(events, record));
		}
		for (const record of of('sns-topic')) {
			steps.push(await topicStep(events, record, input));
		}
		for (const record of of('sqs-queue')) {
			steps.push(await queueStep(events, record, input));
		}
	}

	const users = of('iam-user');
	const keys = of('iam-access-key');
	const buckets = of('s3-bucket');
	if (users.length + keys.length + buckets.length > 0) {
		const global = await (input.clients?.s3 ?? defaultClients)(
			input.credential,
			regionOf(buckets[0]) ?? 'us-east-1',
		);
		const userSteps = new Map<string, AwsDestroyStep>();
		for (const record of users) {
			const step = await userStep(global, record, input);
			userSteps.set(record.id ?? '', step);
			steps.push(step);
		}
		// A key goes with its user, and is checked through it.
		for (const record of keys) {
			const user = (record.data as { user?: string } | undefined)?.user;
			const owner = user ? userSteps.get(user) : undefined;
			steps.push({
				key: record.key,
				label: `IAM access key ${record.id ?? ''} of ${user ?? 'an unknown user'}`,
				...(owner?.leftAlone
					? { leftAlone: `its user is left alone: ${owner.leftAlone}` }
					: owner
						? { gone: true }
						: { leftAlone: 'its user is not one this stage recorded' }),
			});
		}
		for (const record of buckets) {
			const region = regionOf(record) ?? global.region;
			const clients =
				region === global.region
					? global
					: await (input.clients?.s3 ?? defaultClients)(
							input.credential,
							region,
						);
			steps.push(await bucketStep(clients, record, input));
		}
	}

	return { steps, dns };
}

function regionOf(record: ResourceRecord | undefined): string | undefined {
	return (record?.data as { region?: string } | undefined)?.region;
}

// ---------------------------------------------------------------------------
// CloudFront and ACM
// ---------------------------------------------------------------------------

async function distributionStep(
	{ CF, cloudfront }: CdnClients,
	record: ResourceRecord,
	input: AwsDestroyInput,
	wait: { timeoutMs: number; intervalMs: number },
	dns: AwsDnsRecord[],
): Promise<AwsDestroyStep> {
	const id = record.id ?? '';
	const found = await readOr(
		() => cloudfront.send(new CF.GetDistributionCommand({ Id: id })),
		['NoSuchDistribution'],
	);
	const distribution = found?.Distribution;
	const aliases = distribution?.DistributionConfig?.Aliases?.Items ?? [];
	const label = `CloudFront distribution ${id}${aliases.length ? ` (${aliases.join(', ')})` : ''}`;
	if (!distribution) return { key: record.key, label, gone: true };

	// Its tags, or the comment gkm writes on every distribution it makes —
	// `gkm <project> <stage> <file server>`, which nothing else writes.
	const tags = await cloudfront.send(
		new CF.ListTagsForResourceCommand({ Resource: distribution.ARN }),
	);
	const comment = `gkm ${input.identityKey} ${input.stage} ${serverOf(record)}`;
	const marked =
		distribution.DistributionConfig?.Comment === comment.slice(0, 128);
	if (!ours(tags.Tags?.Items, input) && !marked) {
		return {
			key: record.key,
			label,
			leftAlone: `${NOT_TAGGED}, and its comment is not "${comment}"`,
		};
	}
	for (const host of aliases) {
		dns.push({ host, type: 'CNAME', value: distribution.DomainName ?? '' });
	}

	return {
		key: record.key,
		label,
		remove: async () => {
			let current = await cloudfront.send(
				new CF.GetDistributionConfigCommand({ Id: id }),
			);
			if (current.DistributionConfig?.Enabled) {
				await cloudfront.send(
					new CF.UpdateDistributionCommand({
						Id: id,
						IfMatch: current.ETag,
						DistributionConfig: {
							...current.DistributionConfig,
							Enabled: false,
						},
					}),
				);
			}
			const started = Date.now();
			for (;;) {
				const state = await cloudfront.send(
					new CF.GetDistributionCommand({ Id: id }),
				);
				if (state.Distribution?.Status === 'Deployed') break;
				if (Date.now() - started > wait.timeoutMs) {
					throw new DistributionStillDeploying(id, Date.now() - started);
				}
				await sleep(wait.intervalMs);
			}
			current = await cloudfront.send(
				new CF.GetDistributionConfigCommand({ Id: id }),
			);
			await cloudfront.send(
				new CF.DeleteDistributionCommand({ Id: id, IfMatch: current.ETag }),
			);
		},
	};
}

async function originAccessControlStep(
	{ CF, cloudfront }: CdnClients,
	record: ResourceRecord,
	input: AwsDestroyInput,
): Promise<AwsDestroyStep> {
	const id = record.id ?? '';
	const expected = cdnName(input.scope, input.stage, keyId(record));
	const label = `CloudFront origin access control ${expected}`;
	const found = await readOr(
		() => cloudfront.send(new CF.GetOriginAccessControlCommand({ Id: id })),
		['NoSuchOriginAccessControl'],
	);
	if (!found) return { key: record.key, label, gone: true };
	const name = found.OriginAccessControl?.OriginAccessControlConfig?.Name;
	if (name !== expected) {
		return {
			key: record.key,
			label,
			leftAlone: `named ${name}, not this stage's ${expected}`,
		};
	}
	return {
		key: record.key,
		label,
		remove: async () => {
			const { ETag } = await cloudfront.send(
				new CF.GetOriginAccessControlCommand({ Id: id }),
			);
			await cloudfront.send(
				new CF.DeleteOriginAccessControlCommand({ Id: id, IfMatch: ETag }),
			);
		},
	};
}

async function headersPolicyStep(
	{ CF, cloudfront }: CdnClients,
	record: ResourceRecord,
	input: AwsDestroyInput,
): Promise<AwsDestroyStep> {
	const id = record.id ?? '';
	// `cloudfront-headers:<server>:<kind>`
	const [server = '', kind = ''] = keyId(record).split(':');
	const expected = `${cdnName(input.scope, input.stage, server)}-${kind}`;
	const label = `CloudFront response headers policy ${expected}`;
	const found = await readOr(
		() =>
			cloudfront.send(new CF.GetResponseHeadersPolicyConfigCommand({ Id: id })),
		['NoSuchResponseHeadersPolicy'],
	);
	if (!found) return { key: record.key, label, gone: true };
	const name = found.ResponseHeadersPolicyConfig?.Name;
	if (name !== expected) {
		return {
			key: record.key,
			label,
			leftAlone: `named ${name}, not this stage's ${expected}`,
		};
	}
	return {
		key: record.key,
		label,
		remove: async () => {
			const { ETag } = await cloudfront.send(
				new CF.GetResponseHeadersPolicyConfigCommand({ Id: id }),
			);
			await cloudfront.send(
				new CF.DeleteResponseHeadersPolicyCommand({ Id: id, IfMatch: ETag }),
			);
		},
	};
}

async function certificateStep(
	{ ACM, acm }: CdnClients,
	record: ResourceRecord,
	input: AwsDestroyInput,
	dns: AwsDnsRecord[],
): Promise<AwsDestroyStep> {
	const arn = record.id ?? '';
	const host = (record.data as { host?: string } | undefined)?.host ?? arn;
	const label = `ACM certificate ${host} (us-east-1)`;
	const found = await readOr(
		() => acm.send(new ACM.DescribeCertificateCommand({ CertificateArn: arn })),
		['ResourceNotFoundException'],
	);
	if (!found?.Certificate) return { key: record.key, label, gone: true };
	const tags = await acm.send(
		new ACM.ListTagsForCertificateCommand({ CertificateArn: arn }),
	);
	if (!ours(tags.Tags, input)) {
		return { key: record.key, label, leftAlone: NOT_TAGGED };
	}
	for (const option of found.Certificate.DomainValidationOptions ?? []) {
		const r = option.ResourceRecord;
		if (r?.Name && r.Value && r.Type === 'CNAME') {
			dns.push({ host: r.Name, type: 'CNAME', value: r.Value });
		}
	}
	return {
		key: record.key,
		label,
		remove: async () => {
			await acm.send(new ACM.DeleteCertificateCommand({ CertificateArn: arn }));
		},
	};
}

// ---------------------------------------------------------------------------
// SNS and SQS
// ---------------------------------------------------------------------------

interface EventClients {
	SNS: typeof import('@aws-sdk/client-sns');
	SQS: typeof import('@aws-sdk/client-sqs');
	sns: (
		region: string,
	) => Promise<InstanceType<typeof import('@aws-sdk/client-sns')['SNSClient']>>;
	sqs: (
		region: string,
	) => Promise<InstanceType<typeof import('@aws-sdk/client-sqs')['SQSClient']>>;
}

async function eventClients(
	credential: AwsProvisioning,
	_records: readonly ResourceRecord[],
): Promise<EventClients> {
	const SNS = await import('@aws-sdk/client-sns');
	const SQS = await import('@aws-sdk/client-sqs');
	const sns = new Map<string, InstanceType<typeof SNS.SNSClient>>();
	const sqs = new Map<string, InstanceType<typeof SQS.SQSClient>>();
	return {
		SNS,
		SQS,
		sns: async (region) => {
			if (!sns.has(region)) {
				const endpoint = awsEndpoint(process.env, 'SNS');
				sns.set(
					region,
					new SNS.SNSClient({
						...(await awsClientConfig(credential, region)),
						...(endpoint ? { endpoint } : {}),
					}),
				);
			}
			return sns.get(region)!;
		},
		sqs: async (region) => {
			if (!sqs.has(region)) {
				const endpoint = awsEndpoint(process.env, 'SQS');
				sqs.set(
					region,
					new SQS.SQSClient({
						...(await awsClientConfig(credential, region)),
						...(endpoint ? { endpoint } : {}),
					}),
				);
			}
			return sqs.get(region)!;
		},
	};
}

/** `arn:aws:sns:<region>:<account>:<name>` */
function arnParts(arn: string) {
	const [, , , region = '', account = '', ...rest] = arn.split(':');
	return { region, account, name: rest.join(':') };
}

function subscriptionStep(
	{ SNS, sns }: EventClients,
	record: ResourceRecord,
): AwsDestroyStep {
	const arn = record.id ?? '';
	const label = `SNS subscription ${keyId(record)}`;
	// Made by gkm, to its own push endpoint: a pending one has no ARN yet.
	if (!arn.startsWith('arn:')) return { key: record.key, label, gone: true };
	return {
		key: record.key,
		label,
		remove: async () => {
			const client = await sns(arnParts(arn).region);
			await readOr(
				() => client.send(new SNS.UnsubscribeCommand({ SubscriptionArn: arn })),
				['NotFound', 'NotFoundException'],
			);
		},
	};
}

async function topicStep(
	{ SNS, sns }: EventClients,
	record: ResourceRecord,
	input: AwsDestroyInput,
): Promise<AwsDestroyStep> {
	const arn = record.id ?? '';
	const label = `SNS topic ${arnParts(arn).name}`;
	const client = await sns(arnParts(arn).region);
	const tags = await readOr(
		() => client.send(new SNS.ListTagsForResourceCommand({ ResourceArn: arn })),
		['NotFound', 'NotFoundException', 'ResourceNotFound'],
	);
	if (!tags) return { key: record.key, label, gone: true };
	if (!ours(tags.Tags, input)) {
		return { key: record.key, label, leftAlone: NOT_TAGGED };
	}
	return {
		key: record.key,
		label,
		remove: async () => {
			await client.send(new SNS.DeleteTopicCommand({ TopicArn: arn }));
		},
	};
}

async function queueStep(
	{ SQS, sqs }: EventClients,
	record: ResourceRecord,
	input: AwsDestroyInput,
): Promise<AwsDestroyStep> {
	const arn = record.id ?? '';
	const { region, account, name } = arnParts(arn);
	const label = `SQS queue ${name}`;
	const client = await sqs(region);
	const url = await readOr(
		() =>
			client.send(
				new SQS.GetQueueUrlCommand({
					QueueName: name,
					QueueOwnerAWSAccountId: account,
				}),
			),
		['QueueDoesNotExist', 'AWS.SimpleQueueService.NonExistentQueue'],
	);
	if (!url?.QueueUrl) return { key: record.key, label, gone: true };
	const queueUrl = url.QueueUrl;
	const tags = await client.send(
		new SQS.ListQueueTagsCommand({ QueueUrl: queueUrl }),
	);
	const list = Object.entries(tags.Tags ?? {}).map(([Key, Value]) => ({
		Key,
		Value,
	}));
	if (!ours(list, input)) {
		return { key: record.key, label, leftAlone: NOT_TAGGED };
	}
	return {
		key: record.key,
		label,
		remove: async () => {
			await client.send(new SQS.DeleteQueueCommand({ QueueUrl: queueUrl }));
		},
	};
}

// ---------------------------------------------------------------------------
// IAM and S3
// ---------------------------------------------------------------------------

type S3Clients = Awaited<ReturnType<typeof defaultClients>>;

async function userStep(
	{ IAM, iam }: S3Clients,
	record: ResourceRecord,
	input: AwsDestroyInput,
): Promise<AwsDestroyStep> {
	const name = record.id ?? '';
	const label = `IAM user ${name}, its access keys and policies`;
	const found = await readOr(
		() => iam.send(new IAM.GetUserCommand({ UserName: name })),
		['NoSuchEntity', 'NoSuchEntityException'],
	);
	if (!found?.User) return { key: record.key, label, gone: true };
	const tags = await iam.send(new IAM.ListUserTagsCommand({ UserName: name }));
	if (found.User.Path !== IAM_USER_PATH || !ours(tags.Tags, input)) {
		return { key: record.key, label, leftAlone: NOT_TAGGED };
	}
	return {
		key: record.key,
		label,
		remove: async () => {
			const keys = await iam.send(
				new IAM.ListAccessKeysCommand({ UserName: name }),
			);
			for (const key of keys.AccessKeyMetadata ?? []) {
				await iam.send(
					new IAM.DeleteAccessKeyCommand({
						UserName: name,
						AccessKeyId: key.AccessKeyId,
					}),
				);
			}
			const inline = await iam.send(
				new IAM.ListUserPoliciesCommand({ UserName: name }),
			);
			for (const policy of inline.PolicyNames ?? []) {
				await iam.send(
					new IAM.DeleteUserPolicyCommand({
						UserName: name,
						PolicyName: policy,
					}),
				);
			}
			const attached = await iam.send(
				new IAM.ListAttachedUserPoliciesCommand({ UserName: name }),
			);
			for (const policy of attached.AttachedPolicies ?? []) {
				await iam.send(
					new IAM.DetachUserPolicyCommand({
						UserName: name,
						PolicyArn: policy.PolicyArn,
					}),
				);
			}
			await iam.send(new IAM.DeleteUserCommand({ UserName: name }));
		},
	};
}

/** Every object version and delete marker in a bucket, a page at a time. */
async function* bucketVersions({ S3, s3 }: S3Clients, bucket: string) {
	let KeyMarker: string | undefined;
	let VersionIdMarker: string | undefined;
	for (;;) {
		const page = await s3.send(
			new S3.ListObjectVersionsCommand({
				Bucket: bucket,
				...(KeyMarker ? { KeyMarker } : {}),
				...(VersionIdMarker ? { VersionIdMarker } : {}),
			}),
		);
		const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
			.filter((o) => o.Key)
			.map((o) => ({
				Key: o.Key!,
				// `null` is the one version an unversioned bucket's object has:
				// named or not, the same object is deleted.
				...(o.VersionId && o.VersionId !== 'null'
					? { VersionId: o.VersionId }
					: {}),
			}));
		if (objects.length > 0) yield objects;
		if (!page.IsTruncated) return;
		KeyMarker = page.NextKeyMarker;
		VersionIdMarker = page.NextVersionIdMarker;
	}
}

async function bucketStep(
	clients: S3Clients,
	record: ResourceRecord,
	input: AwsDestroyInput,
): Promise<AwsDestroyStep> {
	const { S3, s3 } = clients;
	const bucket = record.id ?? '';
	const tagging = await readOr(
		() => s3.send(new S3.GetBucketTaggingCommand({ Bucket: bucket })),
		['NoSuchBucket', 'NoSuchTagSet', 'NoSuchTagSetError'],
	);
	const exists = await readOr(
		() => s3.send(new S3.HeadBucketCommand({ Bucket: bucket })),
		['NotFound', 'NoSuchBucket'],
	);
	const base = `S3 bucket ${bucket}`;
	if (!exists) return { key: record.key, label: base, gone: true };
	if (!ours(tagging?.TagSet, input)) {
		return { key: record.key, label: base, leftAlone: NOT_TAGGED };
	}
	let count = 0;
	for await (const page of bucketVersions(clients, bucket))
		count += page.length;
	return {
		key: record.key,
		label: `${base}, emptied first: ${count} object version${count === 1 ? '' : 's'}`,
		remove: async () => {
			// Until it lists nothing: deleting a version-less object in a bucket
			// whose versioning was suspended leaves a delete marker behind.
			for (let pass = 0; pass < 5; pass++) {
				let deleted = 0;
				for await (const page of bucketVersions(clients, bucket)) {
					// At most a thousand a call.
					for (let i = 0; i < page.length; i += 1000) {
						await s3.send(
							new S3.DeleteObjectsCommand({
								Bucket: bucket,
								Delete: { Objects: page.slice(i, i + 1000), Quiet: true },
							}),
						);
					}
					deleted += page.length;
				}
				if (deleted === 0) break;
			}
			await s3.send(new S3.DeleteBucketCommand({ Bucket: bucket }));
		},
	};
}
