import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	DeleteAccessKeyCommand,
	DeleteUserCommand,
	DeleteUserPolicyCommand,
	GetUserCommand,
	GetUserPolicyCommand,
	IAMClient,
	ListAccessKeysCommand,
	ListUserTagsCommand,
} from '@aws-sdk/client-iam';
import {
	DeleteBucketCommand,
	DeleteBucketCorsCommand,
	DeleteObjectsCommand,
	GetBucketCorsCommand,
	GetBucketEncryptionCommand,
	GetBucketPolicyCommand,
	GetBucketTaggingCommand,
	GetBucketVersioningCommand,
	GetPublicAccessBlockCommand,
	HeadBucketCommand,
	ListObjectVersionsCommand,
	PutPublicAccessBlockCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import type { ConstructManifest } from '@geekmidas/manifest';
import { createStorageClient, registerStorageDriver } from '@geekmidas/storage';
import { s3Driver } from '@geekmidas/storage/aws';
import * as s3Url from '@geekmidas/storage/s3-url';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import {
	answering,
	fakeDocker,
} from '../../compose/__tests__/__helpers__/fakeDocker';
import { composeCommand } from '../../compose/index';
import { DeployJournal } from '../../deploy/journal';
import { createStateStore } from '../../deploy/StateStore';
import { createEmptyState } from '../../deploy/state';
import { secretsStoreFor } from '../../secrets/store';
import type { NormalizedWorkspace } from '../../workspace/types';
import { provisionStage, verifyStageProviders } from '../index';
import {
	BucketNameUnavailable,
	ProvisionedBucketUnreachable,
	RotationInProgress,
} from '../s3/errors';
import { defaultClients, useS3Clients } from '../s3/index';
import { bucketName, iamUserName } from '../s3/naming';
import { userPolicy } from '../s3/policy';

/**
 * The `s3` provider against the AWS emulator the suite already runs (floci),
 * through the SDK's own `AWS_ENDPOINT_URL`: every bucket, user, policy and
 * key is a real call, and the workspace is the compose fixture with a
 * `FileServer` whose `brand/**` is open, an API that writes to it, and a site
 * that calls the API.
 *
 * What floci does not do, and so is asserted as documents instead: it
 * enforces neither IAM nor bucket policies — any key signs, and an anonymous
 * GET of a private object succeeds — and, holding one account, it cannot
 * answer `BucketAlreadyExists`. The clash is made by intercepting
 * `CreateBucket` on the provider's own client.
 */

registerStorageDriver(s3Driver);

const REGION = 'eu-west-1';
const STAGE = 'production';
const DOMAIN = 'shop.example.com';

const admin = {
	region: REGION,
	endpoint: LOCALSTACK_URL,
	forcePathStyle: true,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const s3 = new S3Client(admin);
const iam = new IAMClient(admin);

let dir: string;
let home: string;
let name: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;
const lines: string[] = [];

/** Every bucket and user a run made, to remove afterwards. */
const made = { buckets: new Set<string>(), users: new Set<string>() };

function withFileServer(root: string): void {
	writeFileSync(
		join(root, 'constructs', 'storage.ts'),
		`import { FileServer } from '@geekmidas/constructs/file-server';
import { Email } from '@geekmidas/constructs/email';

export const uploads = new FileServer('Uploads', { open: ['brand/**'] });
export const mail = new Email('Mail', { templates: {} });
`,
	);
	writeFileSync(
		join(root, 'apps', 'api', 'endpoints', 'upload.ts'),
		`import { api } from '../../../constructs/api.js';
import { mail, uploads } from '../../../constructs/storage.js';

export const upload = api
	.post('/upload')
	.dependsOn([uploads, mail])
	.handle(async () => ({ ok: true }));
`,
	);
}

const provision = (
	stage: string,
	options: Partial<Parameters<typeof provisionStage>[0]> = {},
) =>
	provisionStage({
		workspace,
		stage,
		manifest,
		runnables,
		home,
		log: (line) => lines.push(line),
		...options,
	});

async function secretsOf(stage: string) {
	const store = await secretsStoreFor(workspace, stage, { home });
	return (await store.read(stage))?.custom ?? {};
}

async function stateOf(stage: string) {
	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
	return store.read(stage);
}

async function keysOf(user: string): Promise<string[]> {
	const listed = await iam.send(new ListAccessKeysCommand({ UserName: user }));
	return (listed.AccessKeyMetadata ?? []).map((k) => k.AccessKeyId!).sort();
}

/** What a deploy leaves behind in the state: a later `lastDeployedAt`. */
async function deployed(stage: string): Promise<void> {
	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
	const journal = await DeployJournal.open(store, stage, () =>
		createEmptyState(stage, '', ''),
	);
	await new Promise((resolve) => setTimeout(resolve, 5));
	await journal.save();
}

beforeAll(async () => {
	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);

	dir = realpathSync(await createTempDir('gkm-provider-s3-'));
	home = realpathSync(await createTempDir('gkm-provider-home-'));
	vi.stubEnv('GKM_HOME', home);
	// A name no other run in the emulator has used.
	name = `prov-${Date.now().toString(36)}`;
	writeComposeApp(dir, {
		name,
		domain: DOMAIN,
		deployed: [STAGE, 'staging', 'preview', 'scratch'],
		domains: {
			[STAGE]: DOMAIN,
			staging: `staging.${DOMAIN}`,
			preview: `preview.${DOMAIN}`,
			scratch: `scratch.${DOMAIN}`,
		},
		deployObjects: {
			[STAGE]: { provider: 's3', region: REGION },
			staging: { provider: 's3', region: REGION },
			preview: { provider: 's3', region: REGION },
			scratch: { provider: 's3', region: REGION },
		},
	});
	withFileServer(dir);
	({ workspace, manifest, runnables } = await loadComposeApp(dir));
}, 120_000);

beforeEach(() => {
	lines.length = 0;
});

afterAll(async () => {
	for (const bucket of made.buckets) {
		const versions = await s3
			.send(new ListObjectVersionsCommand({ Bucket: bucket }))
			.catch(() => undefined);
		const objects = [
			...(versions?.Versions ?? []),
			...(versions?.DeleteMarkers ?? []),
		].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
		if (objects.length > 0) {
			await s3.send(
				new DeleteObjectsCommand({
					Bucket: bucket,
					Delete: { Objects: objects },
				}),
			);
		}
		await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
	}
	for (const user of made.users) {
		for (const key of await keysOf(user).catch(() => [])) {
			await iam.send(
				new DeleteAccessKeyCommand({ UserName: user, AccessKeyId: key }),
			);
		}
		await iam
			.send(
				new DeleteUserPolicyCommand({
					UserName: user,
					PolicyName: 'gkm-bucket',
				}),
			)
			.catch(() => {});
		await iam.send(new DeleteUserCommand({ UserName: user })).catch(() => {});
	}
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe('objects: s3 on a deployed stage', () => {
	const bucket = () => bucketName({ scope: name, stage: STAGE, id: 'uploads' });
	const user = () => iamUserName({ scope: name, stage: STAGE, id: 'uploads' });

	it('creates the bucket, its settings, user, policy and key, and writes the URL', async () => {
		made.buckets.add(bucket());
		made.users.add(user());

		const [report] = await provision(STAGE);

		expect(report).toMatchObject({
			kind: 'objects',
			mode: 'provider',
			provider: 's3',
			credentials: true,
		});
		const changes = report!.actions.map((a) => `${a.resource}: ${a.change}`);
		expect(changes).toEqual([
			`bucket ${bucket()}: create in ${REGION}`,
			`bucket ${bucket()}: tag`,
			`bucket ${bucket()}: block public access (ACLs; the policy opens the open paths)`,
			`bucket ${bucket()}: policy: TLS only, public read on brand/**`,
			`bucket ${bucket()}: CORS for https://${DOMAIN}`,
			`IAM user ${user()}: create under /gkm/`,
			`IAM user ${user()}: policy gkm-bucket: this bucket only`,
			`IAM user ${user()}: create an access key`,
			`UPLOADS_SERVER_URL: set to ${LOCALSTACK_URL}/${bucket()}`,
		]);

		// The bucket's URL, with the user's key in it, in the stage's secrets.
		const secrets = await secretsOf(STAGE);
		const address = s3Url.parse(secrets.UPLOADS_URL!);
		expect(address).toMatchObject({
			bucket: bucket(),
			region: REGION,
			endpoint: LOCALSTACK_URL,
			forcePathStyle: true,
		});
		expect(address.accessKeyId).toBeTruthy();
		expect(await keysOf(user())).toEqual([address.accessKeyId]);
		// The secret is never printed.
		expect(lines.join('\n')).not.toContain(address.secretAccessKey);
		expect(secrets.UPLOADS_SERVER_URL).toBe(`${LOCALSTACK_URL}/${bucket()}`);

		// Recorded in the stage's state, by identity.
		const state = await stateOf(STAGE);
		expect(state?.resources['s3-bucket:Uploads']).toMatchObject({
			status: 'ready',
			id: bucket(),
		});
		expect(state?.resources['iam-user:Uploads']).toMatchObject({
			status: 'ready',
			id: user(),
		});
		expect(state?.resources['iam-access-key:Uploads']).toMatchObject({
			status: 'ready',
			id: address.accessKeyId,
		});

		// What the bucket holds.
		const Bucket = bucket();
		expect(
			(await s3.send(new GetPublicAccessBlockCommand({ Bucket })))
				.PublicAccessBlockConfiguration,
		).toEqual({
			BlockPublicAcls: true,
			IgnorePublicAcls: true,
			BlockPublicPolicy: false,
			RestrictPublicBuckets: false,
		});
		expect(
			(await s3.send(new GetBucketEncryptionCommand({ Bucket })))
				.ServerSideEncryptionConfiguration?.Rules?.[0]
				?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm,
		).toBe('AES256');
		// floci does not enforce bucket policies, so the document is what is
		// asserted: TLS only, and anonymous reads on exactly `brand/*`.
		const policy = JSON.parse(
			(await s3.send(new GetBucketPolicyCommand({ Bucket }))).Policy!,
		);
		expect(policy.Statement).toEqual([
			{
				Sid: 'GkmDenyInsecureTransport',
				Effect: 'Deny',
				Principal: '*',
				Action: 's3:*',
				Resource: [`arn:aws:s3:::${Bucket}`, `arn:aws:s3:::${Bucket}/*`],
				Condition: { Bool: { 'aws:SecureTransport': 'false' } },
			},
			{
				Sid: 'GkmOpenPaths',
				Effect: 'Allow',
				Principal: '*',
				Action: 's3:GetObject',
				Resource: [`arn:aws:s3:::${Bucket}/brand/*`],
			},
		]);
		expect(
			(await s3.send(new GetBucketCorsCommand({ Bucket }))).CORSRules,
		).toEqual([
			{
				AllowedMethods: ['GET', 'HEAD', 'POST', 'PUT'],
				AllowedOrigins: [`https://${DOMAIN}`],
				AllowedHeaders: ['*'],
				ExposeHeaders: ['ETag'],
				MaxAgeSeconds: 3000,
			},
		]);
		expect(
			(await s3.send(new GetBucketTaggingCommand({ Bucket }))).TagSet,
		).toEqual(
			expect.arrayContaining([
				{ Key: 'gkm:project', Value: `${name}/${name}` },
				{ Key: 'gkm:stage', Value: STAGE },
				{ Key: 'gkm:construct', Value: 'Uploads' },
			]),
		);
		expect(
			(await s3.send(new GetBucketVersioningCommand({ Bucket }))).Status,
		).toBeUndefined();

		// The user: under /gkm/, tagged, with a policy for this bucket only.
		const found = await iam.send(new GetUserCommand({ UserName: user() }));
		expect(found.User?.Path).toBe('/gkm/');
		const tags = await iam.send(new ListUserTagsCommand({ UserName: user() }));
		expect(tags.Tags).toEqual(
			expect.arrayContaining([
				{ Key: 'gkm:project', Value: `${name}/${name}` },
				{ Key: 'gkm:stage', Value: STAGE },
			]),
		);
		const inline = await iam.send(
			new GetUserPolicyCommand({ UserName: user(), PolicyName: 'gkm-bucket' }),
		);
		expect(JSON.parse(decodeURIComponent(inline.PolicyDocument!))).toEqual(
			userPolicy(Bucket),
		);
	});

	it('changes nothing on a second run', async () => {
		const before = await secretsOf(STAGE);

		const [report] = await provision(STAGE);

		expect(report?.actions).toEqual([]);
		expect(await secretsOf(STAGE)).toEqual(before);
		expect(await keysOf(user())).toHaveLength(1);
		expect(lines).toContain('   up to date');
	});

	it('puts back what drifted', async () => {
		const Bucket = bucket();
		await s3.send(new DeleteBucketCorsCommand({ Bucket }));
		await s3.send(
			new PutPublicAccessBlockCommand({
				Bucket,
				PublicAccessBlockConfiguration: {
					BlockPublicAcls: false,
					IgnorePublicAcls: false,
					BlockPublicPolicy: false,
					RestrictPublicBuckets: false,
				},
			}),
		);

		const [report] = await provision(STAGE);

		expect(report?.actions.map((a) => a.change)).toEqual([
			'block public access (ACLs; the policy opens the open paths)',
			`CORS for https://${DOMAIN}`,
		]);
		expect(
			(await s3.send(new GetBucketCorsCommand({ Bucket }))).CORSRules?.[0]
				?.AllowedOrigins,
		).toEqual([`https://${DOMAIN}`]);
		expect(
			(await s3.send(new GetPublicAccessBlockCommand({ Bucket })))
				.PublicAccessBlockConfiguration?.BlockPublicAcls,
		).toBe(true);
	});

	it('presigns a PUT and a GET with the key it wrote', async () => {
		const storage = createStorageClient((await secretsOf(STAGE)).UPLOADS_URL!);
		const body = 'hello from the provisioned key';

		const put = await storage.getUploadURL({
			path: 'docs/hello.txt',
			contentType: 'text/plain',
			contentLength: body.length,
		});
		const uploaded = await fetch(put, {
			method: 'PUT',
			headers: { 'Content-Type': 'text/plain' },
			body,
		});
		expect(uploaded.status).toBe(200);

		const get = await storage.getDownloadURL({ path: 'docs/hello.txt' });
		const downloaded = await fetch(get);
		expect(downloaded.status).toBe(200);
		expect(await downloaded.text()).toBe(body);
	});

	it('verifies with the written key, and fails once the bucket is gone', async () => {
		const secrets = await secretsOf(STAGE);

		await expect(
			verifyStageProviders({ workspace, manifest, stage: STAGE, secrets }),
		).resolves.toEqual(['objects: s3']);

		// The same key, pointed at a bucket that does not exist.
		const address = s3Url.parse(secrets.UPLOADS_URL!);
		const missing = s3Url.build({ ...address, bucket: `${bucket()}-gone` });
		const run = verifyStageProviders({
			workspace,
			manifest,
			stage: STAGE,
			secrets: { ...secrets, UPLOADS_URL: missing },
		});
		await expect(run).rejects.toBeInstanceOf(ProvisionedBucketUnreachable);
		await expect(run).rejects.toThrow(
			/does not exist\. Run gkm setup --stage production/,
		);
	});

	it('rotates the key: a second key now, the first deleted after the next deploy', async () => {
		const first = s3Url.parse((await secretsOf(STAGE)).UPLOADS_URL!)
			.accessKeyId!;

		const [rotated] = await provision(STAGE, { rotateKeys: true });

		expect(rotated?.actions.map((a) => a.change)).toEqual([
			'rotate: issue a new access key',
		]);
		const second = s3Url.parse((await secretsOf(STAGE)).UPLOADS_URL!)
			.accessKeyId!;
		expect(second).not.toBe(first);
		expect(await keysOf(user())).toEqual([first, second].sort());
		expect(lines.join('\n')).toContain(`Deploy '${STAGE}' now`);

		// Not deployed yet: the old key stays, and a second rotation waits.
		const [waiting] = await provision(STAGE);
		expect(waiting?.actions).toEqual([]);
		expect(await keysOf(user())).toEqual([first, second].sort());
		await expect(provision(STAGE, { rotateKeys: true })).rejects.toBeInstanceOf(
			RotationInProgress,
		);

		// Deployed with the new key: the next run deletes the old one.
		await deployed(STAGE);
		const [retired] = await provision(STAGE);
		expect(retired?.actions.map((a) => a.change)).toEqual([
			`delete the rotated-out access key ${first}`,
		]);
		expect(await keysOf(user())).toEqual([second]);
		expect(
			(await stateOf(STAGE))?.resources['iam-access-key:Uploads'],
		).toMatchObject({ id: second, data: { user: user() } });
	});

	it('retires the old key at once with --retire-old-keys', async () => {
		const before = s3Url.parse((await secretsOf(STAGE)).UPLOADS_URL!)
			.accessKeyId!;
		await provision(STAGE, { rotateKeys: true });
		const after = s3Url.parse((await secretsOf(STAGE)).UPLOADS_URL!)
			.accessKeyId!;

		await provision(STAGE, { retireOldKeys: true });

		expect(await keysOf(user())).toEqual([after]);
		expect(after).not.toBe(before);
	});

	it('passes a compose deploy of the stage, which verifies the bucket', async () => {
		// Mail is not the provider's: the stage's own.
		const store = await secretsStoreFor(workspace, STAGE, { home });
		const stored = (await store.read(STAGE))!;
		await store.write(STAGE, {
			...stored,
			custom: {
				...stored.custom,
				MAIL_URL: 'smtp://user:password@smtp.example.com:587',
				MAIL_FROM: `noreply@${DOMAIN}`,
			},
		});
		const info: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			info.push(a.join(' '));
		});
		const fake = fakeDocker();

		try {
			const result = await composeCommand(
				{ cwd: dir, stage: STAGE, dryRun: true },
				{
					docker: fake.docker,
					probe: answering(fake.calls),
					revision: async () => 'abc1234',
				},
			);

			// No MinIO: the bucket is the provider's.
			expect(result?.stack.infra).not.toContain('minio');
			expect(info.join('\n')).toContain('✓ objects: s3 verified');
		} finally {
			vi.mocked(console.log).mockRestore();
		}
	}, 120_000);
});

describe('a name another account holds', () => {
	const taken = (names: (bucket: string) => boolean) =>
		useS3Clients(async (credential, region) => {
			const clients = await defaultClients(credential, region);
			clients.s3.middlewareStack.add(
				(next, context) => async (args) => {
					const input = args.input as { Bucket?: string };
					if (
						context.commandName === 'CreateBucketCommand' &&
						input.Bucket &&
						names(input.Bucket)
					) {
						throw Object.assign(new Error('The bucket name is taken'), {
							name: 'BucketAlreadyExists',
						});
					}
					return next(args);
				},
				{ step: 'initialize', name: 'bucketTakenElsewhere' },
			);
			return clients;
		});

	it('adds a random suffix, records the name, and reuses it ever after', async () => {
		const good = bucketName({ scope: name, stage: 'staging', id: 'uploads' });
		made.users.add(
			iamUserName({ scope: name, stage: 'staging', id: 'uploads' }),
		);
		const previous = taken((bucket) => bucket === good);
		let recorded: string | undefined;
		try {
			await provision('staging');
			recorded = (await stateOf('staging'))?.resources['s3-bucket:Uploads']?.id;
			if (recorded) made.buckets.add(recorded);
		} finally {
			useS3Clients(previous);
		}

		expect(recorded).toMatch(new RegExp(`^${good}-[a-z0-9]{6}$`));
		expect(s3Url.parse((await secretsOf('staging')).UPLOADS_URL!).bucket).toBe(
			recorded,
		);
		expect(lines.join('\n')).toContain(`'${good}' is taken by another account`);
		await expect(
			s3.send(new HeadBucketCommand({ Bucket: good })),
		).rejects.toThrow();

		// The clash is over and the good name is free: the recorded one is kept.
		const [again] = await provision('staging');
		expect(again?.actions).toEqual([]);
		expect((await stateOf('staging'))?.resources['s3-bucket:Uploads']?.id).toBe(
			recorded,
		);
	});

	it('fails naming every name tried when all of them are taken', async () => {
		const previous = taken(() => true);
		try {
			const run = provision('scratch');
			await expect(run).rejects.toBeInstanceOf(BucketNameUnavailable);
			const error = (await run.catch((e) => e)) as BucketNameUnavailable;
			expect(error.tried).toHaveLength(6);
			expect(error.tried[0]).toBe(
				bucketName({ scope: name, stage: 'scratch', id: 'uploads' }),
			);
		} finally {
			useS3Clients(previous);
		}
	});
});

describe('--dry-run', () => {
	it('prints the plan, and creates and writes nothing', async () => {
		const good = bucketName({ scope: name, stage: 'preview', id: 'uploads' });

		const [report] = await provision('preview', { dryRun: true });

		expect(report?.actions.map((a) => `${a.resource}: ${a.change}`)).toEqual([
			`bucket ${good}: create in ${REGION}`,
			`bucket ${good}: tag`,
			`bucket ${good}: block public access (ACLs; the policy opens the open paths)`,
			`bucket ${good}: policy: TLS only, public read on brand/**`,
			`bucket ${good}: CORS for https://preview.${DOMAIN}`,
			`IAM user ${iamUserName({ scope: name, stage: 'preview', id: 'uploads' })}: create under /gkm/`,
			`IAM user ${iamUserName({ scope: name, stage: 'preview', id: 'uploads' })}: policy gkm-bucket: this bucket only`,
			`IAM user ${iamUserName({ scope: name, stage: 'preview', id: 'uploads' })}: create an access key`,
			`UPLOADS_SERVER_URL: set to ${LOCALSTACK_URL}/${good}`,
		]);
		expect(lines.join('\n')).toContain(
			`would create in ${REGION} — bucket ${good}`,
		);
		await expect(
			s3.send(new HeadBucketCommand({ Bucket: good })),
		).rejects.toThrow();
		await expect(
			iam.send(
				new GetUserCommand({
					UserName: iamUserName({
						scope: name,
						stage: 'preview',
						id: 'uploads',
					}),
				}),
			),
		).rejects.toThrow();
		expect(await secretsOf('preview')).toEqual({});
		expect(await stateOf('preview')).toBeNull();
	});
});

describe('with no credentials to provision with', () => {
	it('leaves the stage external, saying what to supply and what to run', async () => {
		vi.stubEnv('AWS_ACCESS_KEY_ID', undefined);
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', undefined);
		vi.stubEnv('AWS_SESSION_TOKEN', undefined);
		vi.stubEnv('AWS_PROFILE', undefined);
		vi.stubEnv('AWS_CONFIG_FILE', join(home, 'no-aws-config'));
		vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(home, 'no-aws-credentials'));
		vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
		try {
			const [report] = await provision('preview');

			expect(report).toMatchObject({ mode: 'provider', credentials: false });
			expect(report?.actions).toEqual([]);
			const said = lines.join('\n');
			expect(said).toContain(
				"no credentials to provision with, so 'preview' is external for now",
			);
			expect(said).toContain('UPLOADS_URL, UPLOADS_SERVER_URL');
			expect(said).toContain('gkm secrets:add --stage preview');
			expect(said).toContain('AWS_PROFILE');
			expect(said).toContain('run gkm setup --stage preview');
			expect(await secretsOf('preview')).toEqual({});
		} finally {
			vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
			vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
		}
	});
});
