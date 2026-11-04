import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ACMClient,
	DeleteCertificateCommand,
	DescribeCertificateCommand,
	ListCertificatesCommand,
	RequestCertificateCommand,
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
} from '@aws-sdk/client-cloudfront';
import { GetUserCommand, IAMClient } from '@aws-sdk/client-iam';
import {
	HeadBucketCommand,
	PutObjectCommand,
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
	serveFrom,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { fakeDocker } from '../../compose/__tests__/__helpers__/fakeDocker';
import { composeDestroyCommand } from '../../compose/destroy';
import { dnsRecordResource } from '../../deploy/dnsResources';
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

/**
 * `gkm compose --destroy` against the AWS emulator (floci): a file server
 * behind a CDN made by a real provisioning run, then destroyed — the bucket
 * with what is in it, the IAM user, the distribution, its origin access
 * control and headers policies, its certificate, and the DNS records the CDN
 * was given. And what it must not delete: a certificate gkm adopted rather
 * than made, a record pointed elsewhere since gkm wrote it.
 *
 * floci deploys a disabled distribution at once, so the wait for it to
 * finish is real but short.
 */

const REGION = 'eu-west-1';

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
	records: DnsRecord[] = [];
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
			else {
				this.records.push({
					name: r.name,
					type: r.type,
					ttl: r.ttl,
					values: [r.value],
				});
			}
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
		return records.map((record) => {
			const before = this.records.length;
			this.records = this.records.filter(
				(r) => !(r.name === record.name && r.type === record.type),
			);
			const deleted = this.records.length < before;
			return { record, deleted, notFound: !deleted };
		});
	}
	value(name: string, type = 'CNAME'): string | undefined {
		return this.records.find((r) => r.name === name && r.type === type)
			?.values[0];
	}
}

/** This suite's names: `dst-<base36 time>`, and their run's time. */
const RUN = /\bdst-([0-9a-z]+)(?=[-.\s/]|$)/;

/**
 * Every CDN resource `owned` claims, removed — what a run that failed part
 * way left. The emulator holds AWS's quotas (20 headers policies an
 * account), so leftovers would fail every other suite's run after a few.
 */
async function removeCdn(owned: (name: string) => boolean): Promise<void> {
	const ignore = () => {};
	const list = await cloudfront.send(new ListDistributionsCommand({}));
	for (const d of list.DistributionList?.Items ?? []) {
		if (!owned(d.Comment ?? '')) continue;
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

let dir: string;
let home: string;
let name: string;
let domain: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let zone: Zone;
let lines: string[];

const store = () =>
	createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

const resourcesOf = async (stage: string) =>
	(await (await store()).read(stage))?.resources ?? {};

const provision = async (stage: string) => {
	const secrets = await secretsStoreFor(workspace, stage, { home });
	await provisionStage({
		workspace,
		stage,
		manifest,
		home,
		secrets: {
			read: () => secrets.read(stage),
			write: (value) => secrets.write(stage, value),
		},
		state: await store(),
		dnsProviderFor: async () => zone,
		log: (line) => lines.push(line),
	});
};

const destroy = (stage: string) =>
	composeDestroyCommand(
		{ cwd: dir, stage },
		{
			docker: fakeDocker().docker,
			interactive: () => true,
			ask: async () => `${name}-${stage}`,
			awsCredentials: async () => ({ chain: true, region: REGION }),
			aws: { wait: { timeoutMs: 60_000, intervalMs: 200 } },
			dnsProviderFor: async () => zone,
			home,
			log: (line) => lines.push(line),
		},
	);

const missing = (send: Promise<unknown>) =>
	send.then(
		() => false,
		() => true,
	);

beforeAll(async () => {
	// What a run that died left behind — an hour old, so never one going on
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

	dir = realpathSync(await createTempDir('gkm-provider-destroy-'));
	home = realpathSync(await createTempDir('gkm-provider-destroy-home-'));
	vi.stubEnv('GKM_HOME', home);
	name = `dst-${Date.now().toString(36)}`;
	domain = `${name}.example.com`;
	writeComposeApp(dir, {
		name,
		target: 'compose',
		deployed: ['production', 'adopted'],
		domains: { production: domain, adopted: `adopted.${domain}` },
		dns: { [domain]: { provider: 'route53' } },
		deployObjects: {
			production: { provider: 's3', region: REGION },
			adopted: { provider: 's3', region: REGION },
		},
	});
	for (const stage of ['production', 'adopted']) {
		await serveFrom(dir, stage, undefined, home);
	}
	writeFileSync(
		join(dir, 'constructs', 'storage.ts'),
		`import { FileServer } from '@geekmidas/constructs/file-server';

export const uploads = new FileServer('Uploads', { open: ['brand/**'] });
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
	zone = new Zone();
}, 120_000);

beforeEach(() => {
	lines = [];
});

afterAll(async () => {
	// What this run made and a failing test did not destroy.
	await removeCdn((resource) => resource.includes(name));
	vi.unstubAllEnvs();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe('gkm compose --destroy, against AWS', () => {
	it('deletes what a deploy made for the stage, and forgets it', async () => {
		await provision('production');
		const made = await resourcesOf('production');
		const id = (type: string) =>
			Object.values(made).find((r) => r.type === type)?.id ?? '';
		const bucket = id('s3-bucket');
		const user = id('iam-user');
		const distribution = id('cloudfront-distribution');
		const oac = id('cloudfront-oac');
		const certificate = id('acm-certificate');
		const policies = Object.values(made)
			.filter((r) => r.type === 'cloudfront-headers')
			.map((r) => r.id ?? '');
		expect([bucket, user, distribution, oac, certificate]).not.toContain('');
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: 'brand/logo.png',
				Body: 'x',
			}),
		);
		// A record the stack's DNS wrote, which the state keeps.
		await zone.upsertRecords(domain, [
			{ name: 'api', type: 'A', ttl: 300, value: '203.0.113.10' },
		]);
		await (await store()).putResource(
			'production',
			dnsRecordResource({
				domain,
				name: 'api',
				type: 'A',
				value: '203.0.113.10',
				ttl: 300,
				provider: 'route53',
			}),
		);
		const alias = `uploads-server`;
		expect(zone.value(alias)).toBeDefined();

		await destroy('production');

		expect(
			await missing(s3.send(new HeadBucketCommand({ Bucket: bucket }))),
		).toBe(true);
		expect(
			await missing(iam.send(new GetUserCommand({ UserName: user }))),
		).toBe(true);
		expect(
			await missing(
				cloudfront.send(new GetDistributionCommand({ Id: distribution })),
			),
		).toBe(true);
		expect(
			await missing(
				cloudfront.send(new GetOriginAccessControlCommand({ Id: oac })),
			),
		).toBe(true);
		for (const policy of policies) {
			expect(
				await missing(
					cloudfront.send(
						new GetResponseHeadersPolicyConfigCommand({ Id: policy }),
					),
				),
			).toBe(true);
		}
		expect(
			await missing(
				acm.send(
					new DescribeCertificateCommand({ CertificateArn: certificate }),
				),
			),
		).toBe(true);
		// The CDN's name, and the stack's record, are gone from the zone.
		expect(zone.value(alias)).toBeUndefined();
		expect(zone.value('api', 'A')).toBeUndefined();
		// Nothing the stage recorded is left but what names no resource.
		expect(
			Object.values(await resourcesOf('production')).map((r) => r.type),
		).toEqual([]);
	}, 180_000);

	it('leaves a certificate it adopted, and a record pointed elsewhere since', async () => {
		// Made by hand, before the stage's first deploy: no gkm tags.
		const host = `uploads-server.adopted.${domain}`;
		const own = await acm.send(
			new RequestCertificateCommand({
				DomainName: host,
				ValidationMethod: 'DNS',
			}),
		);
		try {
			await provision('adopted');
			const made = await resourcesOf('adopted');
			const adopted = Object.values(made).find(
				(r) => r.type === 'acm-certificate',
			);
			expect(adopted?.id).toBe(own.CertificateArn);
			// Someone pointed the CDN's name somewhere else since.
			const alias = 'uploads-server.adopted';
			expect(zone.value(alias)).toBeDefined();
			await zone.upsertRecords(domain, [
				{
					name: alias,
					type: 'CNAME',
					ttl: 300,
					value: 'elsewhere.example.net',
				},
			]);

			await destroy('adopted');

			expect(
				await missing(
					acm.send(
						new DescribeCertificateCommand({
							CertificateArn: own.CertificateArn,
						}),
					),
				),
			).toBe(false);
			expect(zone.value(alias)).toBe('elsewhere.example.net');
			expect(lines.join('\n')).toMatch(/ACM certificate .* — not tagged/);
			// Left alone, it stays recorded.
			expect(
				Object.values(await resourcesOf('adopted')).map((r) => r.type),
			).toEqual(['acm-certificate']);
		} finally {
			await acm
				.send(
					new DeleteCertificateCommand({ CertificateArn: own.CertificateArn }),
				)
				.catch(() => {});
		}
	}, 180_000);
});
