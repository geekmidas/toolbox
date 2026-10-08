/**
 * `objects: { provider: 's3' }` — each bucket construct, created in the
 * stage's AWS account with a user and key of its own.
 *
 * Per `ObjectStorage` (and each `FileServer` over it), on the stage:
 *
 * - **the bucket**, named `<namespace>-<project>-<stage>-<id>` — or with a
 *   random suffix when another account holds that name — recorded in the
 *   stage's state and reused forever; Block Public Access, SSE-S3, a policy
 *   refusing anything but TLS, versioning when asked, and CORS for the
 *   stage's sites that call an API using it;
 * - **an IAM user**, `gkm-<project>-<stage>-<id>` under `/gkm/`, tagged with
 *   the deploy identity, with an inline policy for that bucket only;
 * - **its access key**, written into the stage's secrets as the bucket's URL
 *   (`s3://KEY:SECRET@bucket?region=…`) — the secret is never printed;
 * - **a file server's** open paths public on exactly those prefixes, and its
 *   URL the bucket's regional endpoint.
 *
 * Every run reads what is there and puts back what drifted. Nothing is ever
 * deleted, with one exception asked for by name: the old key a
 * `--rotate-keys` replaced, once the stage has deployed with the new one.
 */

import type {
	ConstructManifest,
	FileServerDeclaration,
	ObjectsDeclaration,
} from '@geekmidas/manifest';
import { provideKey } from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';
import { appKey } from '../../workspace/derive.js';
import type { S3ObjectsConfig } from '../../workspace/types.js';
import {
	type AwsProvisioning,
	awsClientConfig,
	awsEndpoint,
	awsProvisioningCredentials,
} from '../aws.js';
import type {
	EnsureContext,
	ResourceProvider,
	StateEntry,
	VerifyContext,
} from '../types.js';
import { checkS3Config, S3_PROVISIONING } from './config.js';
import {
	AccessKeyLimit,
	BucketKeySetElsewhere,
	BucketNameUnavailable,
	BucketOwnedByAnotherProject,
	IamUserNotOwned,
	ProvisionedBucketUnreachable,
	RecordedBucketUnreachable,
	RotationInProgress,
	S3RegionRequired,
} from './errors.js';
import {
	bucketName,
	IAM_POLICY_NAME,
	IAM_USER_PATH,
	iamUserName,
	randomSuffix,
	SUFFIX_ATTEMPTS,
	suffixedBucketName,
} from './naming.js';
import { bucketOrigins } from './origins.js';
import {
	bucketPolicy,
	type CorsRule,
	canonicalPolicy,
	corsRule,
	publicAccessBlock,
	userPolicy,
} from './policy.js';

type S3Module = typeof import('@aws-sdk/client-s3');
type IamModule = typeof import('@aws-sdk/client-iam');

type Ctx = EnsureContext<S3ObjectsConfig, AwsProvisioning>;

/** The tags gkm finds its own buckets and users by. */
export const TAG_PROJECT = 'gkm:project';
export const TAG_STAGE = 'gkm:stage';
export const TAG_CONSTRUCT = 'gkm:construct';

/** Each bucket construct, with the file servers over it. */
export interface BucketConstruct {
	id: string;
	versioned: boolean;
	servers: { id: string; open: readonly string[] }[];
}

export function bucketConstructs(
	manifest: ConstructManifest,
): BucketConstruct[] {
	return Object.entries(manifest)
		.filter(([, d]) => d.kind === 'objects')
		.map(([id, d]) => ({
			id,
			versioned: (d as ObjectsDeclaration).versioned === true,
			servers: Object.entries(manifest)
				.filter(
					([, s]) =>
						s.kind === 'file-server' && (s as FileServerDeclaration).of === id,
				)
				.map(([sid, s]) => ({
					id: sid,
					open: (s as FileServerDeclaration).open ?? [],
				}))
				.sort((a, b) => a.id.localeCompare(b.id)),
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The region the stage's buckets are created in: the entry's, the secrets
 * store's when it is in AWS, the credential's, `AWS_REGION`.
 */
export function s3Region(
	ctx: Pick<Ctx, 'config' | 'workspace' | 'stage'> & {
		credential?: AwsProvisioning;
	},
	env: NodeJS.ProcessEnv = process.env,
): string {
	const store = ctx.workspace.secrets?.store;
	const storeRegion =
		store && typeof store === 'object' && 'region' in store
			? (store as { region?: string }).region
			: undefined;
	const region =
		ctx.config.region ??
		storeRegion ??
		ctx.credential?.region ??
		env.AWS_REGION ??
		env.AWS_DEFAULT_REGION;
	if (!region) throw new S3RegionRequired(ctx.stage);
	return region;
}

/**
 * The address a file server over `bucket` serves on: the bucket's regional
 * virtual-host endpoint, which is what `FileServer.url(key)` appends a key to
 * — `https://<bucket>.s3.<region>.amazonaws.com/<key>`. Against an emulator,
 * its path-style address.
 */
export function bucketPublicUrl(
	bucket: string,
	region: string,
	endpoint?: string,
): string {
	if (endpoint) return `${endpoint.replace(/\/+$/, '')}/${bucket}`;
	return `https://${bucket}.s3.${region}.amazonaws.com`;
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

interface Clients {
	S3: S3Module;
	IAM: IamModule;
	s3: InstanceType<S3Module['S3Client']>;
	iam: InstanceType<IamModule['IAMClient']>;
	region: string;
	/** An emulator's endpoint, when the environment names one. */
	endpoint?: string;
}

/** Clients for a provisioning run, for tests to replace. */
export type S3ClientFactory = (
	credential: AwsProvisioning,
	region: string,
) => Promise<Clients>;

export const defaultClients: S3ClientFactory = async (credential, region) => {
	const S3 = await import('@aws-sdk/client-s3');
	const IAM = await import('@aws-sdk/client-iam');
	const config = await awsClientConfig(credential, region);
	const endpoint = awsEndpoint(process.env, 'S3');
	return {
		S3,
		IAM,
		s3: new S3.S3Client({
			...config,
			...(endpoint ? { endpoint, forcePathStyle: true } : {}),
		}),
		iam: new IAM.IAMClient(config),
		region,
		...(endpoint ? { endpoint } : {}),
	};
};

/** For tests: what makes the clients. */
let makeClients: S3ClientFactory = defaultClients;

/** Replace the client factory — a test intercepting a call. Returns the old one. */
export function useS3Clients(factory: S3ClientFactory): S3ClientFactory {
	const previous = makeClients;
	makeClients = factory;
	return previous;
}

async function ensureS3(ctx: Ctx): Promise<void> {
	const region = s3Region(ctx);
	const clients = await makeClients(ctx.credential, region);
	for (const construct of bucketConstructs(ctx.manifest)) {
		await ensureBucket(ctx, clients, construct);
	}
}

/** The keys gkm tags a bucket and a user with. */
function identityTags(ctx: Ctx, id: string) {
	return [
		{ Key: TAG_PROJECT, Value: ctx.identity.key },
		{ Key: TAG_STAGE, Value: ctx.stage },
		{ Key: TAG_CONSTRUCT, Value: id },
	];
}

async function ensureBucket(
	ctx: Ctx,
	clients: Clients,
	construct: BucketConstruct,
): Promise<void> {
	const { id } = construct;
	const nameInput = {
		scope: ctx.identity.scope,
		stage: ctx.stage,
		id: appKey(id),
	};
	const versioning = ctx.config.versioning ?? construct.versioned;
	const open = [...new Set(construct.servers.flatMap((s) => s.open))].sort();

	const { bucket, exists } = await ensureBucketName(
		ctx,
		clients,
		id,
		bucketName(nameInput),
	);
	await ensureBucketSettings(ctx, clients, {
		id,
		bucket,
		exists,
		versioning,
		open,
	});

	const user = await ensureUser(
		ctx,
		clients,
		id,
		iamUserName(nameInput),
		userPolicy(bucket, { versioning }),
	);
	await ensureAccessKey(ctx, clients, { id, bucket, ...user });

	// Each file server over it serves on the bucket's own endpoint — unless the
	// stage set an address of its own for it (a CDN), which is kept.
	const publicUrl = bucketPublicUrl(bucket, clients.region, clients.endpoint);
	for (const server of construct.servers) {
		const key = provideKey(server.id, 'url');
		const entry: StateEntry = { key: `file-server:${server.id}`, type: 'url' };
		const recorded = ctx.state.record(entry.key)?.id;
		const current = ctx.secrets[key];
		if (current === publicUrl) {
			await ctx.state.ready(entry, publicUrl);
			continue;
		}
		if (current !== undefined && current !== recorded) {
			ctx.log(
				`   ${key} is set to ${current} by you, and kept — the bucket's own address is ${publicUrl}`,
			);
			continue;
		}
		await ctx.change(
			{ construct: server.id, resource: key, change: `set to ${publicUrl}` },
			async () => {
				await ctx.writeSecrets({ [key]: publicUrl });
				await ctx.state.ready(entry, publicUrl);
			},
		);
	}
}

/**
 * The bucket's name: the recorded one, else the good name, else the good
 * name with a random suffix — up to {@link SUFFIX_ATTEMPTS} times.
 */
async function ensureBucketName(
	ctx: Ctx,
	clients: Clients,
	id: string,
	good: string,
): Promise<{ bucket: string; exists: boolean }> {
	const { S3, s3, region } = clients;
	const key = `s3-bucket:${id}`;
	const record = ctx.state.record(key);
	const entry = (name: string): StateEntry => ({
		key,
		type: 's3-bucket',
		data: { name, region },
	});

	/** Whether this account holds `name`: yes, no, or someone else does. */
	const probe = async (name: string): Promise<'ours' | 'none' | 'taken'> => {
		try {
			await s3.send(new S3.HeadBucketCommand({ Bucket: name }));
			return 'ours';
		} catch (error) {
			const name = errorName(error);
			if (name === 'NotFound' || name === 'NoSuchBucket') return 'none';
			if (name === 'Forbidden' || name === 'AccessDenied') return 'taken';
			throw error;
		}
	};

	const create = async (
		name: string,
	): Promise<'created' | 'ours' | 'taken'> => {
		if (ctx.dryRun) {
			const found = await probe(name);
			if (found === 'none') {
				await ctx.change(
					{
						construct: id,
						resource: `bucket ${name}`,
						change: `create in ${region}`,
					},
					async () => {},
				);
				return 'created';
			}
			return found;
		}
		await ctx.state.pending(entry(name));
		try {
			await s3.send(
				new S3.CreateBucketCommand({
					Bucket: name,
					// us-east-1 is the one region named by leaving it out.
					...(region === 'us-east-1'
						? {}
						: {
								CreateBucketConfiguration: {
									LocationConstraint:
										region as import('@aws-sdk/client-s3').BucketLocationConstraint,
								},
							}),
				}),
			);
		} catch (error) {
			const code = errorName(error);
			if (code === 'BucketAlreadyOwnedByYou') return 'ours';
			if (code === 'BucketAlreadyExists') return 'taken';
			throw error;
		}
		await ctx.change(
			{
				construct: id,
				resource: `bucket ${name}`,
				change: `create in ${region}`,
			},
			async () => {},
		);
		return 'created';
	};

	const adopt = async (name: string): Promise<void> => {
		const tags = await readOr(
			() => s3.send(new S3.GetBucketTaggingCommand({ Bucket: name })),
			['NoSuchTagSet', 'NoSuchTagSetError'],
		);
		const owner = tags?.TagSet?.find((t) => t.Key === TAG_PROJECT)?.Value;
		if (owner && owner !== ctx.identity.key) {
			throw new BucketOwnedByAnotherProject(name, owner, ctx.identity.key);
		}
	};

	// Recorded: the name is the stage's forever. Gone, it is made again under
	// the same name — never a new one.
	if (record?.status === 'ready' && record.id) {
		const found = await probe(record.id);
		if (found === 'ours') return { bucket: record.id, exists: true };
		if (found === 'taken') throw new RecordedBucketUnreachable(id, record.id);
		const made = await create(record.id);
		if (made === 'taken') throw new RecordedBucketUnreachable(id, record.id);
		if (!ctx.dryRun) await ctx.state.ready(entry(record.id), record.id);
		return { bucket: record.id, exists: made === 'ours' };
	}

	// A run that died between creating a suffixed bucket and recording it.
	const pending = record?.data?.name;
	const names = [
		...(typeof pending === 'string' && pending !== good ? [pending] : []),
		good,
		...Array.from({ length: SUFFIX_ATTEMPTS }, () =>
			suffixedBucketName(good, randomSuffix()),
		),
	];
	const tried: string[] = [];
	for (const name of names) {
		tried.push(name);
		const made = await create(name);
		if (made === 'taken') continue;
		if (made === 'ours') await adopt(name);
		if (!ctx.dryRun) await ctx.state.ready(entry(name), name);
		if (name !== good) {
			ctx.log(
				`   '${good}' is taken by another account; '${id}' is '${name}', recorded in the stage's state`,
			);
		}
		return { bucket: name, exists: made === 'ours' };
	}
	throw new BucketNameUnavailable(
		id,
		tried.filter((n) => n !== pending),
	);
}

/** Tags, Block Public Access, encryption, policy, versioning and CORS. */
async function ensureBucketSettings(
	ctx: Ctx,
	clients: Clients,
	input: {
		id: string;
		bucket: string;
		/** False when a dry run would create it: nothing to read yet. */
		exists: boolean;
		versioning: boolean;
		open: readonly string[];
	},
): Promise<void> {
	const { S3, s3 } = clients;
	const { id, bucket } = input;
	const Bucket = bucket;
	// A bucket a dry run would create has nothing to read: every setting
	// would be set.
	const fresh = ctx.dryRun && !input.exists;
	const read = async <T>(
		fn: () => Promise<T>,
		missing: readonly string[],
	): Promise<T | undefined> => (fresh ? undefined : readOr(fn, missing));
	const set = (change: string, apply: () => Promise<unknown>) =>
		ctx.change({ construct: id, resource: `bucket ${bucket}`, change }, () =>
			apply().then(() => undefined),
		);

	// Tags — gkm's three, beside whatever else is there.
	const tagged = await read(
		() => s3.send(new S3.GetBucketTaggingCommand({ Bucket })),
		['NoSuchTagSet', 'NoSuchTagSetError'],
	);
	const ours = identityTags(ctx, id);
	const others = (tagged?.TagSet ?? []).filter(
		(t) => !ours.some((o) => o.Key === t.Key),
	);
	const missingTag = ours.some(
		(o) => !tagged?.TagSet?.some((t) => t.Key === o.Key && t.Value === o.Value),
	);
	if (missingTag) {
		await set('tag', () =>
			s3.send(
				new S3.PutBucketTaggingCommand({
					Bucket,
					Tagging: {
						TagSet: [...others, ...ours].map((t) => ({
							Key: t.Key!,
							Value: t.Value!,
						})),
					},
				}),
			),
		);
	}

	const isOpen = input.open.length > 0;
	const block = publicAccessBlock(isOpen);
	const ensureBlock = async () => {
		const current = await read(
			() => s3.send(new S3.GetPublicAccessBlockCommand({ Bucket })),
			['NoSuchPublicAccessBlockConfiguration'],
		);
		const now = current?.PublicAccessBlockConfiguration;
		const same =
			now &&
			(Object.keys(block) as (keyof typeof block)[]).every(
				(k) => (now[k] ?? false) === block[k],
			);
		if (!same) {
			await set(
				isOpen
					? 'block public access (ACLs; the policy opens the open paths)'
					: 'block all public access',
				() =>
					s3.send(
						new S3.PutPublicAccessBlockCommand({
							Bucket,
							PublicAccessBlockConfiguration: block,
						}),
					),
			);
		}
	};

	const policy = bucketPolicy(bucket, input.open);
	const ensurePolicy = async () => {
		const current = await read(
			() => s3.send(new S3.GetBucketPolicyCommand({ Bucket })),
			['NoSuchBucketPolicy'],
		);
		const same =
			current?.Policy !== undefined &&
			canonicalPolicy(JSON.parse(current.Policy)) === canonicalPolicy(policy);
		if (!same) {
			await set(
				isOpen
					? `policy: TLS only, public read on ${input.open.join(', ')}`
					: 'policy: TLS only',
				() =>
					s3.send(
						new S3.PutBucketPolicyCommand({
							Bucket,
							Policy: JSON.stringify(policy),
						}),
					),
			);
		}
	};

	// A public policy is refused while BlockPublicPolicy is on, and a block
	// put back while one is in place would refuse the next put: relax the
	// block before opening, and close the policy before blocking.
	if (isOpen) {
		await ensureBlock();
		await ensurePolicy();
	} else {
		await ensurePolicy();
		await ensureBlock();
	}

	// Default encryption: SSE-S3.
	const encryption = await read(
		() => s3.send(new S3.GetBucketEncryptionCommand({ Bucket })),
		['ServerSideEncryptionConfigurationNotFoundError'],
	);
	const algorithm =
		encryption?.ServerSideEncryptionConfiguration?.Rules?.[0]
			?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
	// A new bucket is SSE-S3 already — S3 has encrypted every new bucket by
	// default since 2023 — so a dry run does not promise to set it.
	if (algorithm !== 'AES256' && !fresh) {
		await set('encrypt by default (SSE-S3)', () =>
			s3.send(
				new S3.PutBucketEncryptionCommand({
					Bucket,
					ServerSideEncryptionConfiguration: {
						Rules: [
							{
								ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
							},
						],
					},
				}),
			),
		);
	}

	// Versioning: on when asked; a bucket that had it is suspended, never
	// stripped of the versions it kept.
	const versioning = await read(
		() => s3.send(new S3.GetBucketVersioningCommand({ Bucket })),
		[],
	);
	const status = versioning?.Status;
	if (input.versioning && status !== 'Enabled') {
		await set('enable versioning', () =>
			s3.send(
				new S3.PutBucketVersioningCommand({
					Bucket,
					VersioningConfiguration: { Status: 'Enabled' },
				}),
			),
		);
	} else if (!input.versioning && status === 'Enabled') {
		await set('suspend versioning', () =>
			s3.send(
				new S3.PutBucketVersioningCommand({
					Bucket,
					VersioningConfiguration: { Status: 'Suspended' },
				}),
			),
		);
	}

	// CORS for the stage's sites.
	const { origins, unresolved } = bucketOrigins({
		workspace: ctx.workspace,
		manifest: ctx.manifest,
		runnables: ctx.runnables,
		stage: ctx.stage,
		bucket: id,
	});
	if (unresolved.length > 0) {
		ctx.log(
			`   ${unresolved.join(', ')} ${unresolved.length === 1 ? 'has' : 'have'} no address on '${ctx.stage}' (deploy.domains.${ctx.stage}), so ${unresolved.length === 1 ? 'is' : 'are'} not in '${bucket}''s CORS`,
		);
	}
	if (origins.length === 0) return;
	const rule = corsRule(origins);
	const cors = await read(
		() => s3.send(new S3.GetBucketCorsCommand({ Bucket })),
		['NoSuchCORSConfiguration'],
	);
	const sameCors =
		cors?.CORSRules?.length === 1 &&
		canonicalCors(cors.CORSRules[0]!) === canonicalCors(rule);
	if (!sameCors) {
		await set(`CORS for ${origins.join(', ')}`, () =>
			s3.send(
				new S3.PutBucketCorsCommand({
					Bucket,
					CORSConfiguration: { CORSRules: [rule] },
				}),
			),
		);
	}
}

function canonicalCors(rule: Partial<CorsRule>): string {
	const sorted = (list?: string[]) => [...(list ?? [])].sort();
	return JSON.stringify({
		AllowedMethods: sorted(rule.AllowedMethods),
		AllowedOrigins: sorted(rule.AllowedOrigins),
		AllowedHeaders: sorted(rule.AllowedHeaders),
		ExposeHeaders: sorted(rule.ExposeHeaders),
		MaxAgeSeconds: rule.MaxAgeSeconds ?? null,
	});
}

/** The bucket's IAM user and its inline policy. */
async function ensureUser(
	ctx: Ctx,
	clients: Clients,
	id: string,
	user: string,
	policy: ReturnType<typeof userPolicy>,
): Promise<{ user: string; exists: boolean }> {
	const { IAM, iam } = clients;
	const entry: StateEntry = { key: `iam-user:${id}`, type: 'iam-user' };
	const found = await readOr(
		() => iam.send(new IAM.GetUserCommand({ UserName: user })),
		['NoSuchEntity', 'NoSuchEntityException'],
	);

	if (found?.User) {
		const tags = await iam.send(
			new IAM.ListUserTagsCommand({ UserName: user }),
		);
		const tag = (key: string) => tags.Tags?.find((t) => t.Key === key)?.Value;
		if (
			found.User.Path !== IAM_USER_PATH ||
			tag(TAG_PROJECT) !== ctx.identity.key ||
			tag(TAG_STAGE) !== ctx.stage
		) {
			throw new IamUserNotOwned(user, ctx.identity.key, ctx.stage);
		}
		await ctx.state.ready(entry, user);
	} else {
		await ctx.change(
			{
				construct: id,
				resource: `IAM user ${user}`,
				change: `create under ${IAM_USER_PATH}`,
			},
			async () => {
				await ctx.state.pending(entry);
				await iam.send(
					new IAM.CreateUserCommand({
						UserName: user,
						Path: IAM_USER_PATH,
						Tags: identityTags(ctx, id),
					}),
				);
				await ctx.state.ready(entry, user);
			},
		);
	}

	const exists = Boolean(found?.User) || !ctx.dryRun;
	const current = exists
		? await readOr(
				() =>
					iam.send(
						new IAM.GetUserPolicyCommand({
							UserName: user,
							PolicyName: IAM_POLICY_NAME,
						}),
					),
				['NoSuchEntity', 'NoSuchEntityException'],
			)
		: undefined;
	const document = current?.PolicyDocument
		? JSON.parse(decodePolicy(current.PolicyDocument))
		: undefined;
	if (!document || canonicalPolicy(document) !== canonicalPolicy(policy)) {
		await ctx.change(
			{
				construct: id,
				resource: `IAM user ${user}`,
				change: `policy ${IAM_POLICY_NAME}: this bucket only`,
			},
			async () => {
				await iam.send(
					new IAM.PutUserPolicyCommand({
						UserName: user,
						PolicyName: IAM_POLICY_NAME,
						PolicyDocument: JSON.stringify(policy),
					}),
				);
			},
		);
	}
	return { user, exists };
}

/** IAM returns a policy document URL-encoded; an emulator may not. */
function decodePolicy(document: string): string {
	try {
		return decodeURIComponent(document);
	} catch {
		return document;
	}
}

/**
 * The user's access key, in the stage's secrets as the bucket's URL.
 *
 * - First run: one key, written into the stage's secrets.
 * - `--rotate-keys`: a second key, written in place of the first; the first
 *   stays active until the stage has deployed with the second, and the next
 *   run after that deploy — or `--retire-old-keys` — deletes it.
 * - A key the secrets no longer hold (a store emptied by hand): replaced the
 *   same way, since its secret cannot be read back.
 */
async function ensureAccessKey(
	ctx: Ctx,
	clients: Clients,
	input: { id: string; bucket: string; user: string; exists: boolean },
): Promise<void> {
	const { IAM, iam } = clients;
	const { id, bucket, user } = input;
	const urlKey = provideKey(id, 'url');
	const entryKey = `iam-access-key:${id}`;
	const record = ctx.state.record(entryKey);

	const given = ctx.secrets[urlKey];
	let inUrl: string | undefined;
	if (given !== undefined) {
		let parsed: s3Url.S3Address | undefined;
		try {
			parsed = s3Url.parse(given);
		} catch {
			parsed = undefined;
		}
		if (parsed?.bucket !== bucket) {
			throw new BucketKeySetElsewhere(
				urlKey,
				bucket,
				parsed?.bucket ?? given.replace(/\/\/[^@]*@/, '//'),
				ctx.stage,
			);
		}
		inUrl = parsed.accessKeyId;
	}

	const listed = input.exists
		? ((
				await iam.send(new IAM.ListAccessKeysCommand({ UserName: user }))
			).AccessKeyMetadata?.map((k) => k.AccessKeyId!) ?? [])
		: [];

	let current = record?.status === 'ready' ? record.id : undefined;
	let previous =
		typeof record?.data?.previous === 'string'
			? record.data.previous
			: undefined;
	const rotatedAt =
		typeof record?.data?.rotatedAt === 'string'
			? record.data.rotatedAt
			: undefined;
	const entry = (data: Record<string, unknown> = {}): StateEntry => ({
		key: entryKey,
		type: 'iam-access-key',
		data: { user, ...data },
	});

	// The old key of a rotation: deleted once the stage deployed after it.
	if (previous && current) {
		const deployed =
			rotatedAt !== undefined &&
			ctx.state.lastDeployedAt !== undefined &&
			ctx.state.lastDeployedAt > rotatedAt;
		if (ctx.retireOldKeys || deployed) {
			const old = previous;
			const keep = current;
			await ctx.change(
				{
					construct: id,
					resource: `IAM user ${user}`,
					change: `delete the rotated-out access key ${old}`,
				},
				async () => {
					if (listed.includes(old)) {
						await iam.send(
							new IAM.DeleteAccessKeyCommand({
								UserName: user,
								AccessKeyId: old,
							}),
						);
					}
					await ctx.state.ready(entry(), keep);
				},
			);
			previous = undefined;
		} else {
			ctx.log(
				`   ${id}: the old access key ${previous} stays active until '${ctx.stage}' is deployed with the new one; the next gkm setup --stage ${ctx.stage} after that deletes it (or pass --retire-old-keys)`,
			);
		}
	}

	// No record, and the secrets hold a key of this user's: adopt it.
	if (!current && inUrl && listed.includes(inUrl)) {
		await ctx.state.ready(entry(), inUrl);
		current = inUrl;
	}

	const valid =
		current !== undefined && listed.includes(current) && inUrl === current;
	if (valid && !ctx.rotateKeys) return;
	if (ctx.rotateKeys && previous) {
		throw new RotationInProgress(id, previous, ctx.stage);
	}

	const outgoing = current && listed.includes(current) ? current : undefined;
	if (listed.length >= 2) throw new AccessKeyLimit(user, listed);

	const why = !current
		? 'create an access key'
		: ctx.rotateKeys
			? 'rotate: issue a new access key'
			: 'issue a new access key (the secrets no longer hold the recorded one)';
	await ctx.change(
		{ construct: id, resource: `IAM user ${user}`, change: why },
		async () => {
			await ctx.state.pending(entry(outgoing ? { previous: outgoing } : {}));
			const created = await iam.send(
				new IAM.CreateAccessKeyCommand({ UserName: user }),
			);
			const key = created.AccessKey!;
			// Into the stage's secrets before anything else: IAM shows a secret
			// once, and a key whose secret is lost is a key to replace.
			await ctx.writeSecrets({
				[urlKey]: s3Url.build({
					bucket,
					region: clients.region,
					...(clients.endpoint
						? { endpoint: clients.endpoint, forcePathStyle: true }
						: {}),
					accessKeyId: key.AccessKeyId!,
					secretAccessKey: key.SecretAccessKey!,
				}),
			});
			await ctx.state.ready(
				entry(
					outgoing
						? { previous: outgoing, rotatedAt: new Date().toISOString() }
						: {},
				),
				key.AccessKeyId!,
			);
		},
	);
	if (outgoing) {
		ctx.log(
			`   ${urlKey} holds the new key. Deploy '${ctx.stage}' now; the next gkm setup --stage ${ctx.stage} after that deploy deletes the old key ${outgoing}`,
		);
	}
}

/**
 * Each provisioned bucket answers `HeadBucket` to the key in the stage's
 * secrets — the one the apps will use. A bucket whose URL carries no key is
 * not one this provider wrote, and the deploy's own check covers a URL that
 * is missing.
 */
async function verifyS3(ctx: VerifyContext<S3ObjectsConfig>): Promise<void> {
	const S3 = await import('@aws-sdk/client-s3');
	for (const { id } of bucketConstructs(ctx.manifest)) {
		const url = ctx.secrets[provideKey(id, 'url')];
		if (url === undefined) continue;
		const address = s3Url.parse(url);
		if (!address.accessKeyId || !address.secretAccessKey) continue;
		const client = new S3.S3Client({
			region: address.region ?? ctx.config.region ?? 'us-east-1',
			credentials: {
				accessKeyId: address.accessKeyId,
				secretAccessKey: address.secretAccessKey,
			},
			...(address.endpoint ? { endpoint: address.endpoint } : {}),
			...(address.forcePathStyle ? { forcePathStyle: true } : {}),
		});
		try {
			await client.send(new S3.HeadBucketCommand({ Bucket: address.bucket }));
		} catch (error) {
			const name = errorName(error);
			throw new ProvisionedBucketUnreachable(
				id,
				address.bucket,
				ctx.stage,
				name === 'NotFound'
					? 'it does not exist'
					: name === 'Forbidden'
						? 'the key is refused'
						: name || String(error),
			);
		} finally {
			client.destroy();
		}
	}
}

export const s3Provider: ResourceProvider<S3ObjectsConfig, AwsProvisioning> = {
	kind: 'objects',
	name: 's3',
	check: checkS3Config,
	provisioning: S3_PROVISIONING,
	credentials: awsProvisioningCredentials,
	runtimeKeys(manifest) {
		return bucketConstructs(manifest).flatMap((b) => [
			provideKey(b.id, 'url'),
			...b.servers.map((s) => provideKey(s.id, 'url')),
		]);
	},
	ensure: ensureS3,
	verify: verifyS3,
};
