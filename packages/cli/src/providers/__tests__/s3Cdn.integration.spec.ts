import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ACMClient,
	DeleteCertificateCommand,
	DescribeCertificateCommand,
	type DescribeCertificateCommandOutput,
	ListCertificatesCommand,
} from '@aws-sdk/client-acm';
import {
	CloudFrontClient,
	DeleteDistributionCommand,
	DeleteOriginAccessControlCommand,
	DeleteResponseHeadersPolicyCommand,
	GetDistributionCommand,
	GetDistributionConfigCommand,
	GetOriginAccessControlCommand,
	GetResponseHeadersPolicyConfigCommand,
	ListDistributionsCommand,
	ListOriginAccessControlsCommand,
	ListResponseHeadersPoliciesCommand,
	UpdateDistributionCommand,
	UpdateResponseHeadersPolicyCommand,
} from '@aws-sdk/client-cloudfront';
import {
	DeleteAccessKeyCommand,
	DeleteUserCommand,
	DeleteUserPolicyCommand,
	IAMClient,
	ListAccessKeysCommand,
} from '@aws-sdk/client-iam';
import {
	DeleteBucketCommand,
	GetBucketPolicyCommand,
	GetPublicAccessBlockCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import type { ConstructManifest } from '@geekmidas/manifest';
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
import { createStateStore } from '../../deploy/StateStore';
import { secretsStoreFor } from '../../secrets/store';
import type {
	DeleteDnsRecord,
	DeleteResult,
	DnsProvider,
	DnsRecord,
	UpsertDnsRecord,
	UpsertResult,
} from '../../target/dokploy/dns/DnsProvider';
import type { NormalizedWorkspace } from '../../workspace/types';
import { provisionStage } from '../index';
import {
	CACHING_OPTIMIZED,
	CdnCertificatePending,
	cdnName,
	defaultCdnClients,
	FileServerCdnNeedsDomain,
	IMMUTABLE_CACHE_CONTROL,
	useCdnClients,
} from '../s3/cdn';
import { bucketName, iamUserName } from '../s3/naming';

/**
 * A file server behind a CDN, against the AWS emulator the suite already runs
 * (floci): the certificate, the origin access control, the response headers
 * policies and the distribution are real ACM and CloudFront calls, and the
 * bucket's policy and public access block real S3 ones.
 *
 * What floci does not do, and so is not asserted: it serves nothing through a
 * distribution, enforces no bucket policy, and issues a certificate the moment
 * it is requested — a certificate waiting on its record is made by
 * intercepting `DescribeCertificate` on the provider's own client. DNS goes to
 * an in-memory provider standing in for the domain's (`dnsProviderFor`).
 */

const REGION = 'eu-west-1';
const STAGE = 'production';

const admin = {
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const s3 = new S3Client({ ...admin, region: REGION, forcePathStyle: true });
const iam = new IAMClient({ ...admin, region: REGION });
const cloudfront = new CloudFrontClient({ ...admin, region: 'us-east-1' });
const acm = new ACMClient({ ...admin, region: 'us-east-1' });

/** One zone, held in memory, as a DNS provider holds it. */
class Zone implements DnsProvider {
	readonly name = 'memory';
	readonly records: DnsRecord[] = [];
	async getRecords(): Promise<DnsRecord[]> {
		return this.records.map((r) => ({ ...r, values: [...r.values] }));
	}
	async upsertRecords(
		_domain: string,
		records: UpsertDnsRecord[],
	): Promise<UpsertResult[]> {
		for (const r of records) {
			const existing = this.records.find(
				(z) => z.name === r.name && z.type === r.type,
			);
			if (existing) existing.values = [r.value];
			else
				this.records.push({
					name: r.name,
					type: r.type,
					ttl: r.ttl,
					values: [r.value],
				});
		}
		return records.map((record) => ({
			record,
			created: true,
			unchanged: false,
		}));
	}
	async deleteRecords(
		_domain: string,
		records: DeleteDnsRecord[],
	): Promise<DeleteResult[]> {
		return records.map((record) => ({
			record,
			deleted: false,
			notFound: true,
		}));
	}
	value(name: string): string | undefined {
		return this.records.find((r) => r.name === name)?.values[0];
	}
}

let dir: string;
let home: string;
let name: string;
let domain: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let zone: Zone;
const lines: string[] = [];
const made = { buckets: new Set<string>(), users: new Set<string>() };

/** This suite's names: `gkm-cdn-<base36 time>-…`, and their run's time. */
const RUN = /\bcdn-([0-9a-z]+)(?=[-.\s]|$)/;

/**
 * Every CDN resource whose name `owned` claims, removed: distributions first,
 * then what they held on to. The emulator holds AWS's quotas — 20 response
 * headers policies an account — so a suite that left its own behind would
 * fail every run after the first few.
 */
async function removeCdn(owned: (name: string) => boolean): Promise<void> {
	const ignore = () => {};
	const distributions = await cloudfront.send(new ListDistributionsCommand({}));
	for (const d of distributions.DistributionList?.Items ?? []) {
		if (!owned(d.Comment ?? '')) continue;
		// Only a disabled distribution is deleted, as on AWS.
		const current = await cloudfront.send(
			new GetDistributionConfigCommand({ Id: d.Id! }),
		);
		const disabled = await cloudfront.send(
			new UpdateDistributionCommand({
				Id: d.Id!,
				IfMatch: current.ETag,
				DistributionConfig: { ...current.DistributionConfig!, Enabled: false },
			}),
		);
		await cloudfront
			.send(
				new DeleteDistributionCommand({ Id: d.Id!, IfMatch: disabled.ETag }),
			)
			.catch(ignore);
	}
	const policies = await cloudfront.send(
		new ListResponseHeadersPoliciesCommand({ Type: 'custom' }),
	);
	for (const p of policies.ResponseHeadersPolicyList?.Items ?? []) {
		const policy = p.ResponseHeadersPolicy!;
		if (!owned(policy.ResponseHeadersPolicyConfig?.Name ?? '')) continue;
		const { ETag } = await cloudfront.send(
			new GetResponseHeadersPolicyConfigCommand({ Id: policy.Id! }),
		);
		await cloudfront
			.send(
				new DeleteResponseHeadersPolicyCommand({
					Id: policy.Id!,
					IfMatch: ETag,
				}),
			)
			.catch(ignore);
	}
	const controls = await cloudfront.send(
		new ListOriginAccessControlsCommand({}),
	);
	for (const o of controls.OriginAccessControlList?.Items ?? []) {
		if (!owned(o.Name ?? '')) continue;
		const { ETag } = await cloudfront.send(
			new GetOriginAccessControlCommand({ Id: o.Id! }),
		);
		await cloudfront
			.send(new DeleteOriginAccessControlCommand({ Id: o.Id!, IfMatch: ETag }))
			.catch(ignore);
	}
	const certificates = await acm.send(new ListCertificatesCommand({}));
	for (const c of certificates.CertificateSummaryList ?? []) {
		if (!owned(c.DomainName ?? '')) continue;
		await acm
			.send(new DeleteCertificateCommand({ CertificateArn: c.CertificateArn! }))
			.catch(ignore);
	}
}

const provision = async (
	stage: string,
	options: Partial<Parameters<typeof provisionStage>[0]> = {},
) => {
	const store = await secretsStoreFor(workspace, stage, { home });
	return provisionStage({
		workspace,
		stage,
		manifest,
		home,
		secrets: {
			read: () => store.read(stage),
			write: (secrets) => store.write(stage, secrets),
		},
		state: await createStateStore({
			config: workspace.state,
			workspaceRoot: workspace.root,
			workspaceName: workspace.name,
		}),
		dnsProviderFor: async () => zone,
		log: (line) => lines.push(line),
		...options,
	});
};

async function secretsOf(stage: string) {
	const store = await secretsStoreFor(workspace, stage, { home });
	return (await store.read(stage))?.custom ?? {};
}

async function resourcesOf(stage: string) {
	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
	return (await store.read(stage))?.resources ?? {};
}

beforeAll(async () => {
	// What a run that died left behind — an hour old, so never a run going on
	// beside this one.
	const hourAgo = Date.now() - 60 * 60_000;
	await removeCdn((resource) => {
		const at = RUN.exec(resource)?.[1];
		return at !== undefined && Number.parseInt(at, 36) < hourAgo;
	});

	vi.stubEnv('AWS_ENDPOINT_URL', LOCALSTACK_URL);
	vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
	vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
	vi.stubEnv('AWS_REGION', REGION);
	vi.stubEnv('AWS_PROFILE', undefined);

	dir = realpathSync(await createTempDir('gkm-provider-cdn-'));
	home = realpathSync(await createTempDir('gkm-provider-cdn-home-'));
	vi.stubEnv('GKM_HOME', home);
	// A name, and so a domain and every certificate's name, no other run in
	// the emulator has used.
	name = `cdn-${Date.now().toString(36)}`;
	domain = `${name}.example.com`;
	writeComposeApp(dir, {
		name,
		deployed: [STAGE, 'unserved', 'bare', 'pending', 'planned', 'processed'],
		domains: {
			[STAGE]: domain,
			processed: `processed.${domain}`,
			unserved: `unserved.${domain}`,
			// Under no domain in `dns`: nothing writes its records.
			pending: `${name}.example.org`,
			planned: `planned.${domain}`,
		},
		// Only the stage's own domain has a DNS provider.
		dns: {
			[domain]: { provider: 'route53' },
		},
		deployObjects: {
			[STAGE]: { provider: 's3', region: REGION },
			unserved: { provider: 's3', region: REGION, cdn: false },
			bare: { provider: 's3', region: REGION },
			pending: { provider: 's3', region: REGION },
			planned: { provider: 's3', region: REGION },
			processed: { provider: 's3', region: REGION },
		},
	});
	writeFileSync(
		join(dir, 'constructs', 'storage.ts'),
		`import { FileServer } from '@geekmidas/constructs/file-server';

export const uploads = new FileServer('Uploads', {
	open: ['brand/**'],
	immutable: ['brand/logos/*'],
});
`,
	);
	writeFileSync(
		join(dir, 'apps', 'api', 'endpoints', 'upload.ts'),
		`import { api } from '../../../constructs/api.js';
import { uploads } from '../../../constructs/storage.js';

export const upload = api
	.post('/upload')
	.dependsOn([uploads])
	.handle(async () => ({ ok: true }));
`,
	);
	({ workspace, manifest } = await loadComposeApp(dir));
}, 120_000);

beforeEach(() => {
	lines.length = 0;
	zone = zone ?? new Zone();
});

afterAll(async () => {
	for (const bucket of made.buckets) {
		await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
	}
	for (const user of made.users) {
		const keys = await iam
			.send(new ListAccessKeysCommand({ UserName: user }))
			.catch(() => undefined);
		for (const key of keys?.AccessKeyMetadata ?? []) {
			await iam.send(
				new DeleteAccessKeyCommand({
					UserName: user,
					AccessKeyId: key.AccessKeyId!,
				}),
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
	await removeCdn((resource) => resource.includes(name));
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

const track = (stage: string) => {
	made.buckets.add(bucketName({ scope: name, stage, id: 'uploads' }));
	made.users.add(iamUserName({ scope: name, stage, id: 'uploads' }));
};

describe('a file server behind a CDN', () => {
	const bucket = () => bucketName({ scope: name, stage: STAGE, id: 'uploads' });
	const host = () => `uploads-server.${domain}`;
	const distributionId = async () =>
		(await resourcesOf(STAGE))['cloudfront-distribution:UploadsServer']!.id!;

	it('creates its certificate, origin access, headers policies and distribution, and names it', async () => {
		track(STAGE);
		const [report] = await provision(STAGE);
		const resource = cdnName(name, STAGE, 'UploadsServer');

		const changes = report!.actions.map((a) => `${a.resource}: ${a.change}`);
		expect(changes).toEqual([
			`bucket ${bucket()}: create in ${REGION}`,
			`certificate ${host()}: request (ACM, us-east-1, DNS-validated)`,
			`origin access control ${resource}: create (CloudFront signs its reads of ${bucket()})`,
			`response headers policy ${resource}-cors: create`,
			`response headers policy ${resource}-immutable: create`,
			`distribution ${host()}: create (CloudFront, takes minutes to reach every edge)`,
			`bucket ${bucket()}: tag`,
			// The policy closed before the block, which refuses a public one.
			`bucket ${bucket()}: policy: TLS only, CloudFront reads brand/**`,
			`bucket ${bucket()}: block all public access`,
			`bucket ${bucket()}: CORS for https://${domain}`,
			`IAM user ${iamUserName({ scope: name, stage: STAGE, id: 'uploads' })}: create under /gkm/`,
			`IAM user ${iamUserName({ scope: name, stage: STAGE, id: 'uploads' })}: policy gkm-bucket: this bucket only`,
			`IAM user ${iamUserName({ scope: name, stage: STAGE, id: 'uploads' })}: create an access key`,
			`UPLOADS_SERVER_URL: set to https://${host()}`,
		]);

		// The file server's address is its own name, on the stage's domain.
		expect((await secretsOf(STAGE)).UPLOADS_SERVER_URL).toBe(
			`https://${host()}`,
		);

		const resources = await resourcesOf(STAGE);
		const certificateArn = resources['acm-certificate:UploadsServer']!.id!;
		const id = await distributionId();
		const { Distribution } = await cloudfront.send(
			new GetDistributionCommand({ Id: id }),
		);
		const config = Distribution!.DistributionConfig!;

		// On its name, with its certificate, reading the bucket through the
		// origin access control.
		expect(config.Aliases?.Items).toEqual([host()]);
		expect(config.ViewerCertificate).toMatchObject({
			ACMCertificateArn: certificateArn,
			SSLSupportMethod: 'sni-only',
		});
		expect(config.Origins?.Items?.[0]).toMatchObject({
			DomainName: `${bucket()}.s3.${REGION}.amazonaws.com`,
			OriginAccessControlId: resources['cloudfront-oac:UploadsServer']!.id,
		});
		// HTTPS only, compressed, path-keyed — CORS everywhere, and the
		// forever header on the immutable paths.
		expect(config.DefaultCacheBehavior).toMatchObject({
			ViewerProtocolPolicy: 'redirect-to-https',
			Compress: true,
			CachePolicyId: CACHING_OPTIMIZED,
			ResponseHeadersPolicyId:
				resources['cloudfront-headers:UploadsServer:cors']!.id,
		});
		expect(config.CacheBehaviors?.Items).toEqual([
			expect.objectContaining({
				PathPattern: 'brand/logos/*',
				ResponseHeadersPolicyId:
					resources['cloudfront-headers:UploadsServer:immutable']!.id,
			}),
		]);
		const immutable = await cloudfront.send(
			new GetResponseHeadersPolicyConfigCommand({
				Id: resources['cloudfront-headers:UploadsServer:immutable']!.id!,
			}),
		);
		expect(
			immutable.ResponseHeadersPolicyConfig?.CustomHeadersConfig?.Items,
		).toEqual([
			{
				Header: 'Cache-Control',
				Value: IMMUTABLE_CACHE_CONTROL,
				Override: true,
			},
		]);
		expect(
			immutable.ResponseHeadersPolicyConfig?.CorsConfig
				?.AccessControlAllowOrigins?.Items,
		).toEqual([`https://${domain}`]);

		// The name points at the distribution, and the certificate's
		// validation record is kept beside it, for ACM to renew against.
		expect(zone.value('uploads-server')).toBe(Distribution!.DomainName);
		const { Certificate } = await acm.send(
			new DescribeCertificateCommand({ CertificateArn: certificateArn }),
		);
		const validation =
			Certificate!.DomainValidationOptions![0]!.ResourceRecord!;
		expect(
			zone.value(validation.Name!.replace(/\.$/, '').replace(`.${domain}`, '')),
		).toBe(validation.Value!.replace(/\.$/, ''));
	});

	it('never makes the bucket public: CloudFront alone reads the open paths', async () => {
		const policy = JSON.parse(
			(await s3.send(new GetBucketPolicyCommand({ Bucket: bucket() }))).Policy!,
		);
		const { Distribution } = await cloudfront.send(
			new GetDistributionCommand({ Id: await distributionId() }),
		);

		expect(policy.Statement.map((s: { Sid: string }) => s.Sid)).toEqual([
			'GkmDenyInsecureTransport',
			'GkmCdnRead',
		]);
		expect(policy.Statement[1]).toMatchObject({
			Principal: { Service: 'cloudfront.amazonaws.com' },
			Action: 's3:GetObject',
		});
		expect([policy.Statement[1].Resource].flat()).toEqual([
			`arn:aws:s3:::${bucket()}/brand/*`,
		]);
		expect(
			[policy.Statement[1].Condition.StringEquals['AWS:SourceArn']].flat(),
		).toEqual([Distribution!.ARN]);

		const block = await s3.send(
			new GetPublicAccessBlockCommand({ Bucket: bucket() }),
		);
		expect(block.PublicAccessBlockConfiguration).toEqual({
			BlockPublicAcls: true,
			IgnorePublicAcls: true,
			BlockPublicPolicy: true,
			RestrictPublicBuckets: true,
		});
	});

	it('changes nothing on a second run', async () => {
		const [report] = await provision(STAGE);

		expect(report!.actions).toEqual([]);
	});

	it('puts back what drifted, and keeps what it does not own', async () => {
		const id = await distributionId();
		const current = await cloudfront.send(
			new GetDistributionConfigCommand({ Id: id }),
		);
		await cloudfront.send(
			new UpdateDistributionCommand({
				Id: id,
				IfMatch: current.ETag,
				DistributionConfig: {
					...current.DistributionConfig!,
					DefaultCacheBehavior: {
						...current.DistributionConfig!.DefaultCacheBehavior!,
						Compress: false,
					},
					// Someone else's: a price class gkm never sets.
					PriceClass: 'PriceClass_100',
				},
			}),
		);
		const policyId = (await resourcesOf(STAGE))[
			'cloudfront-headers:UploadsServer:immutable'
		]!.id!;
		const policy = await cloudfront.send(
			new GetResponseHeadersPolicyConfigCommand({ Id: policyId }),
		);
		await cloudfront.send(
			new UpdateResponseHeadersPolicyCommand({
				Id: policyId,
				IfMatch: policy.ETag,
				ResponseHeadersPolicyConfig: {
					...policy.ResponseHeadersPolicyConfig!,
					CustomHeadersConfig: {
						Quantity: 1,
						Items: [
							{ Header: 'Cache-Control', Value: 'no-store', Override: true },
						],
					},
				},
			}),
		);

		const [report] = await provision(STAGE);

		expect(report!.actions.map((a) => `${a.resource}: ${a.change}`)).toEqual([
			`response headers policy ${cdnName(name, STAGE, 'UploadsServer')}-immutable: put back what drifted`,
			`distribution ${id}: put back what drifted`,
		]);
		const after = await cloudfront.send(
			new GetDistributionConfigCommand({ Id: id }),
		);
		expect(after.DistributionConfig?.DefaultCacheBehavior?.Compress).toBe(true);
		expect(after.DistributionConfig?.PriceClass).toBe('PriceClass_100');
		const restored = await cloudfront.send(
			new GetResponseHeadersPolicyConfigCommand({ Id: policyId }),
		);
		expect(
			restored.ResponseHeadersPolicyConfig?.CustomHeadersConfig?.Items?.[0]
				?.Value,
		).toBe(IMMUTABLE_CACHE_CONTROL);
	});

	it('finds everything again when the state lost it, rather than creating twice', async () => {
		const before = await resourcesOf(STAGE);
		rmSync(join(dir, '.gkm'), { recursive: true, force: true });

		const [report] = await provision(STAGE);

		const cdn = report!.actions.filter((a) =>
			/^(certificate|origin access control|response headers policy|distribution) /.test(
				a.resource,
			),
		);
		expect(cdn).toEqual([]);
		const after = await resourcesOf(STAGE);
		for (const key of [
			'acm-certificate:UploadsServer',
			'cloudfront-oac:UploadsServer',
			'cloudfront-headers:UploadsServer:cors',
			'cloudfront-headers:UploadsServer:immutable',
			'cloudfront-distribution:UploadsServer',
		]) {
			expect(after[key]?.id).toBe(before[key]?.id);
		}
	});
});

describe("a file server's processors behind the CDN", () => {
	const stage = 'processed';
	/** The discovered manifest, with a thumbnail processor on the file server. */
	const withProcessors = (): ConstructManifest =>
		({
			...manifest,
			UploadsServer: {
				...manifest.UploadsServer,
				processors: [
					{
						id: 'thumbnails',
						handler: 'apps/api/processors/thumbnails.ts#thumbnails',
						path: '/i/:width/*',
						prefix: '/i/',
						dependencies: [{ target: 'Uploads', kind: 'objects' }],
					},
				],
			},
		}) as unknown as ConstructManifest;
	const configOf = async () => {
		const id = (await resourcesOf(stage))[
			'cloudfront-distribution:UploadsServer'
		]!.id!;
		return (await cloudfront.send(new GetDistributionConfigCommand({ Id: id })))
			.DistributionConfig!;
	};

	it('sends each pattern to the processor unit, with a secret the stage keeps', async () => {
		track(stage);
		await provision(stage, { manifest: withProcessors() });

		const secret = (await secretsOf(stage)).UPLOADS_SERVER_ORIGIN_SECRET;
		expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

		const config = await configOf();
		const origin = config.Origins?.Items?.find((o) => o.Id === 'processors');
		expect(origin).toMatchObject({
			DomainName: `uploads-server-processors.processed.${domain}`,
			CustomOriginConfig: { OriginProtocolPolicy: 'https-only' },
			CustomHeaders: {
				Quantity: 1,
				Items: [{ HeaderName: 'X-Gkm-Origin-Verify', HeaderValue: secret }],
			},
		});
		expect(
			config.CacheBehaviors?.Items?.map((b) => [
				b.PathPattern,
				b.TargetOriginId,
			]),
		).toEqual([
			['i/*', 'processors'],
			['brand/logos/*', 'bucket'],
		]);
	});

	it('keeps the secret, and changes nothing, on a second run', async () => {
		const before = (await secretsOf(stage)).UPLOADS_SERVER_ORIGIN_SECRET;
		const [report] = await provision(stage, { manifest: withProcessors() });

		expect(report!.actions).toEqual([]);
		expect((await secretsOf(stage)).UPLOADS_SERVER_ORIGIN_SECRET).toBe(before);
	});
});

describe('a stage without a CDN', () => {
	it('serves from the bucket’s own endpoint with cdn: false', async () => {
		track('unserved');
		const [report] = await provision('unserved');
		const bucket = bucketName({
			scope: name,
			stage: 'unserved',
			id: 'uploads',
		});

		expect(report!.actions.map((a) => a.resource)).not.toContain(
			expect.stringMatching(/distribution|certificate/),
		);
		expect((await secretsOf('unserved')).UPLOADS_SERVER_URL).toBe(
			`${LOCALSTACK_URL}/${bucket}`,
		);
	});

	it('refuses a CDN on a stage with no domain, before anything is created', async () => {
		const run = provision('bare');

		await expect(run).rejects.toBeInstanceOf(FileServerCdnNeedsDomain);
		await expect(run).rejects.toThrow(/domains\.bare/);
		await expect(run).rejects.toThrow(/cdn to false/);
		track('bare');
	});
});

describe('a certificate waiting on its record', () => {
	/** ACM as it is before it has seen the record: pending, for ever. */
	const pendingAcm = () =>
		useCdnClients(async (credential) => {
			const clients = await defaultCdnClients(credential);
			const send = clients.acm.send.bind(clients.acm);
			clients.acm.send = (async (command: unknown) => {
				const out = await send(command as never);
				if (command instanceof DescribeCertificateCommand) {
					const described = out as DescribeCertificateCommandOutput;
					return {
						...described,
						Certificate: {
							...described.Certificate,
							Status: 'PENDING_VALIDATION',
						},
					};
				}
				return out;
			}) as typeof clients.acm.send;
			return { ...clients, wait: { timeoutMs: 50, intervalMs: 10 } };
		});

	it('prints the record no DNS provider can write, and stops on it by name', async () => {
		track('pending');
		const previous = pendingAcm();
		try {
			const run = provision('pending');

			await expect(run).rejects.toBeInstanceOf(CdnCertificatePending);
			const error = (await run.catch((e) => e)) as CdnCertificatePending;
			expect(error.reason).toBe('manual');
			expect(error.host).toBe(`uploads-server.${name}.example.org`);
			expect(error.message).toContain(
				`${error.record.name} CNAME ${error.record.value}`,
			);
			expect(error.message).toContain('deploy again');
		} finally {
			useCdnClients(previous);
		}
		// What came before it is recorded, for the next deploy to carry on.
		expect(
			(await resourcesOf('pending'))['acm-certificate:UploadsServer']?.id,
		).toMatch(/^arn:aws:acm:/);
	});

	it('waits on a record it wrote, then says it is still not issued', async () => {
		track(STAGE);
		const previous = pendingAcm();
		rmSync(join(dir, '.gkm'), { recursive: true, force: true });
		try {
			const run = provision(STAGE);

			await expect(run).rejects.toBeInstanceOf(CdnCertificatePending);
			const error = (await run.catch((e) => e)) as CdnCertificatePending;
			expect(error.reason).toBe('timeout');
			expect(lines).toContain(
				`   waiting for ACM to issue the certificate for uploads-server.${domain}…`,
			);
		} finally {
			useCdnClients(previous);
		}
	});
});

describe('--dry-run', () => {
	it('prints the CDN it would create, and creates and writes nothing', async () => {
		const [report] = await provision('planned', { dryRun: true });
		const host = `uploads-server.planned.${domain}`;

		expect(report!.actions.map((a) => `${a.resource}: ${a.change}`)).toEqual(
			expect.arrayContaining([
				`certificate ${host}: request (ACM, us-east-1, DNS-validated)`,
				`distribution ${host}: create (CloudFront, takes minutes to reach every edge)`,
			]),
		);
		expect(await secretsOf('planned')).toEqual({});
		expect(await resourcesOf('planned')).toEqual({});
	});
});
