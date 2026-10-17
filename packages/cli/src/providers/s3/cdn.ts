/**
 * A file server over an `s3` bucket, served through a CDN.
 *
 * Without one a file server answers on the bucket's regional endpoint: every
 * reader, wherever they are, fetches from one region, on an `amazonaws.com`
 * host. With one — the default — each file server gets, on the stage:
 *
 * - **a certificate** for `<fileserver>.<domain>`, from ACM in us-east-1 (the
 *   one region CloudFront reads certificates from), validated by a CNAME the
 *   deploy writes through the stage's DNS providers and keeps, because ACM
 *   renews against the same record;
 * - **an origin access control**, which signs CloudFront's requests to the
 *   bucket, and a bucket policy statement granting exactly the stage's
 *   distributions `s3:GetObject` on exactly the open prefixes (see
 *   `bucketPolicy`) — the bucket itself is never public;
 * - **response headers policies**: CORS for the stage's sites (the same
 *   derivation the bucket's own CORS rule uses), and, for the paths the file
 *   server calls `immutable`, `Cache-Control: public, max-age=31536000,
 *   immutable` over whatever the object was stored with;
 * - **a distribution** on that name: HTTPS only, compressed, GET/HEAD/OPTIONS,
 *   cached with AWS's managed `CachingOptimized` policy — keyed on the path
 *   alone, so no query string or cookie fragments the cache;
 * - **a CNAME** from the name to the distribution, through the same DNS
 *   providers.
 *
 * Open paths only: a key outside them is refused to CloudFront by the bucket
 * policy, so the edge answers it 403, and a signed read goes to the bucket's
 * own host as before (`signedUrl` is an S3 presign).
 *
 * Every resource is recorded in the stage's state and reused, found by its
 * name when a run died before recording it, and put back when it drifted.
 * Nothing is ever deleted.
 */

import type {
	DistributionConfig,
	ResponseHeadersPolicyConfig,
} from '@aws-sdk/client-cloudfront';
import { GkmError } from '../../errors';
import { appKey } from '../../workspace/derive.js';
import type { S3ObjectsConfig } from '../../workspace/types.js';
import { type AwsProvisioning, awsClientConfig, awsEndpoint } from '../aws.js';
import { identityTags } from '../iam.js';
import type { EnsureContext, StateEntry } from '../types.js';

type CloudFrontModule = typeof import('@aws-sdk/client-cloudfront');
type AcmModule = typeof import('@aws-sdk/client-acm');

type Ctx = EnsureContext<S3ObjectsConfig, AwsProvisioning>;

/** AWS's managed `CachingOptimized` cache policy: path-keyed, gzip and brotli. */
export const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';

/** What an immutable path is served with. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The only region CloudFront reads a certificate from. */
const CDN_REGION = 'us-east-1';

/** The distribution's one origin. */
const ORIGIN_ID = 'bucket';

/** A file server, as the CDN serves it. */
export interface CdnServer {
	id: string;
	open: readonly string[];
	immutable: readonly string[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A CDN is a name on the stage's domain, and the stage has none. */
export class FileServerCdnNeedsDomain extends GkmError {
	constructor(
		readonly server: string,
		readonly stage: string,
	) {
		super(
			`'${server}' is served through a CDN on '${stage}', which answers on ` +
				`<fileserver>.<domain> — and '${stage}' has no domain. Set ` +
				`domains.${stage} in gkm.config.ts, or set deploy.objects.${stage}.cdn ` +
				"to false to serve it from the bucket's own endpoint.",
		);
		this.name = 'FileServerCdnNeedsDomain';
	}
}

/**
 * The certificate is waiting on its validation record: one the person has to
 * create, or one that has not propagated yet. Everything up to it is
 * recorded, so the next deploy carries on from here.
 */
export class CdnCertificatePending extends GkmError {
	constructor(
		readonly server: string,
		readonly host: string,
		readonly record: { name: string; value: string },
		readonly reason: 'manual' | 'timeout',
	) {
		super(
			(reason === 'manual'
				? `The certificate for ${host} ('${server}') is validated by a DNS ` +
					'record no DNS provider in gkm.config.ts can write. Create it at ' +
					"the domain's DNS host:\n"
				: `The certificate for ${host} ('${server}') is not issued yet: ACM ` +
					'has not seen its validation record. It is written; DNS can take ' +
					'a while to answer with it. Check it resolves:\n') +
				`  ${record.name} CNAME ${record.value}\n` +
				'then deploy again — the certificate and everything before it are ' +
				'recorded, and the deploy carries on from there.',
		);
		this.name = 'CdnCertificatePending';
	}
}

/** ACM gave up on the certificate. */
export class CdnCertificateFailed extends GkmError {
	constructor(
		readonly server: string,
		readonly host: string,
		readonly status: string,
		readonly reason: string | undefined,
	) {
		super(
			`ACM did not issue the certificate for ${host} ('${server}'): ${status}` +
				(reason ? ` (${reason})` : '') +
				'. A CAA record on the domain that does not allow amazon.com, or a ' +
				'validation record removed before it was checked, are the usual ' +
				'causes. Fix it and deploy again: a new certificate is requested.',
		);
		this.name = 'CdnCertificateFailed';
	}
}

// ---------------------------------------------------------------------------
// Names and documents — pure
// ---------------------------------------------------------------------------

/** Where a file server answers: `<fileserver>.<domain>`. */
export function cdnHost(serverId: string, domain: string): string {
	return `${appKey(serverId)}.${domain}`.toLowerCase();
}

/**
 * The name the stage's CDN resources go by, within CloudFront's limits:
 * letters, digits, `-` and `_`, and at most 64 characters (an origin access
 * control's). Kept whole where it fits; otherwise shortened with a hash of
 * the whole, so two long names never meet.
 */
export function cdnName(
	scope: string,
	stage: string,
	serverId: string,
): string {
	const whole = `gkm-${scope}-${stage}-${appKey(serverId)}`.replace(
		/[^A-Za-z0-9_-]/g,
		'-',
	);
	if (whole.length <= 56) return whole;
	return `${whole.slice(0, 47)}-${hash(whole)}`;
}

function hash(value: string): string {
	let h = 2166136261;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36).padStart(8, '0').slice(0, 8);
}

/**
 * An open or immutable glob as a CloudFront path pattern. CloudFront's `*`
 * crosses `/`, so a single star is as wide as a double one — the bucket
 * policy reads it the same way, and the construct's own check is the
 * stricter of the three.
 */
export function pathPattern(glob: string): string {
	return glob.replace(/^\/+/, '').replace(/\*\*/g, '*');
}

/** A CloudFront list: its `Quantity` and, when it has some, its `Items`. */
function list<T>(items: readonly T[]): { Quantity: number; Items?: T[] } {
	return items.length > 0
		? { Quantity: items.length, Items: [...items] }
		: { Quantity: 0 };
}

/** One of the stage's response headers policies. */
export function headersPolicyConfig(input: {
	name: string;
	comment: string;
	/** The stage's sites, for CORS; none, no CORS. */
	origins: readonly string[];
	immutable: boolean;
}): ResponseHeadersPolicyConfig {
	return {
		Name: input.name,
		Comment: input.comment,
		...(input.origins.length > 0
			? {
					CorsConfig: {
						AccessControlAllowOrigins: list([...input.origins].sort()) as {
							Quantity: number;
							Items: string[];
						},
						AccessControlAllowHeaders: { Quantity: 1, Items: ['*'] },
						AccessControlAllowMethods: {
							Quantity: 3,
							Items: ['GET', 'HEAD', 'OPTIONS'],
						},
						AccessControlAllowCredentials: false,
						AccessControlMaxAgeSec: 86400,
						OriginOverride: false,
					},
				}
			: {}),
		...(input.immutable
			? {
					CustomHeadersConfig: {
						Quantity: 1,
						Items: [
							{
								Header: 'Cache-Control',
								Value: IMMUTABLE_CACHE_CONTROL,
								// Over the origin: objects already in the bucket were
								// stored with whatever they were stored with, or nothing.
								Override: true,
							},
						],
					},
				}
			: {}),
	};
}

/** The parts of a distribution's config this provider owns. */
export function distributionConfig(input: {
	comment: string;
	callerReference: string;
	host: string;
	certificateArn: string;
	/** The bucket's regional domain. */
	bucketDomain: string;
	originAccessControlId: string;
	/** For every path: CORS. */
	corsPolicyId?: string;
	/** For the immutable paths: CORS and the forever header. */
	immutablePolicyId?: string;
	immutable: readonly string[];
}): DistributionConfig {
	const behaviour = (policy?: string) => ({
		TargetOriginId: ORIGIN_ID,
		ViewerProtocolPolicy: 'redirect-to-https' as const,
		AllowedMethods: {
			Quantity: 3,
			Items: ['GET' as const, 'HEAD' as const, 'OPTIONS' as const],
			CachedMethods: { Quantity: 2, Items: ['GET' as const, 'HEAD' as const] },
		},
		Compress: true,
		CachePolicyId: CACHING_OPTIMIZED,
		...(policy ? { ResponseHeadersPolicyId: policy } : {}),
	});
	const patterns = [...new Set(input.immutable.map(pathPattern))].sort();
	return {
		CallerReference: input.callerReference,
		Comment: input.comment,
		Enabled: true,
		Aliases: { Quantity: 1, Items: [input.host] },
		Origins: {
			Quantity: 1,
			Items: [
				{
					Id: ORIGIN_ID,
					DomainName: input.bucketDomain,
					OriginPath: '',
					S3OriginConfig: { OriginAccessIdentity: '' },
					OriginAccessControlId: input.originAccessControlId,
				},
			],
		},
		DefaultCacheBehavior: behaviour(input.corsPolicyId),
		CacheBehaviors: list(
			patterns.map((PathPattern) => ({
				...behaviour(input.immutablePolicyId),
				PathPattern,
			})),
		),
		ViewerCertificate: {
			ACMCertificateArn: input.certificateArn,
			SSLSupportMethod: 'sni-only',
			MinimumProtocolVersion: 'TLSv1.2_2021',
			CloudFrontDefaultCertificate: false,
		},
		HttpVersion: 'http2and3',
		IsIPV6Enabled: true,
		DefaultRootObject: '',
	} as DistributionConfig;
}

/**
 * Whether `current` already holds everything in `wanted`: each key `wanted`
 * names, recursively, with lists compared as sets. What else `current` holds
 * — logging, a WAF, geo restrictions set by hand — is left alone, and a
 * `CallerReference`, fixed at creation, is never compared.
 */
export function holds(
	current: unknown,
	wanted: unknown,
	key?: string,
): boolean {
	if (key === 'CallerReference') return true;
	if (Array.isArray(wanted)) {
		return (
			Array.isArray(current) &&
			current.length === wanted.length &&
			wanted.every((w) => current.some((c) => holds(c, w)))
		);
	}
	if (wanted && typeof wanted === 'object') {
		if (!current || typeof current !== 'object') return false;
		return Object.entries(wanted).every(([k, v]) =>
			holds((current as Record<string, unknown>)[k], v, k),
		);
	}
	return current === wanted;
}

/** Header configs a policy may hold that this provider never sets. */
const FOREIGN_HEADER_CONFIGS = [
	'CorsConfig',
	'CustomHeadersConfig',
	'SecurityHeadersConfig',
	'RemoveHeadersConfig',
	'ServerTimingHeadersConfig',
] as const;

/** Whether a policy is exactly what is wanted: nothing missing, nothing more. */
export function sameHeadersPolicy(
	current: ResponseHeadersPolicyConfig | undefined,
	wanted: ResponseHeadersPolicyConfig,
): boolean {
	if (!current || !holds(current, wanted)) return false;
	return FOREIGN_HEADER_CONFIGS.every((k) => {
		if (k in wanted) return true;
		const extra = current[k] as { Quantity?: number } | undefined;
		return !extra || extra.Quantity === 0;
	});
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface CdnClients {
	CF: CloudFrontModule;
	ACM: AcmModule;
	cloudfront: InstanceType<CloudFrontModule['CloudFrontClient']>;
	acm: InstanceType<AcmModule['ACMClient']>;
	/** How long a certificate is waited on, and how often it is asked. */
	wait: { timeoutMs: number; intervalMs: number };
}

export type CdnClientFactory = (
	credential: AwsProvisioning,
) => Promise<CdnClients>;

export const defaultCdnClients: CdnClientFactory = async (credential) => {
	const CF = await import('@aws-sdk/client-cloudfront');
	const ACM = await import('@aws-sdk/client-acm');
	const config = await awsClientConfig(credential, CDN_REGION);
	const cloudfront = awsEndpoint(process.env, 'CLOUDFRONT');
	const acm = awsEndpoint(process.env, 'ACM');
	return {
		CF,
		ACM,
		cloudfront: new CF.CloudFrontClient({
			...config,
			...(cloudfront ? { endpoint: cloudfront } : {}),
		}),
		acm: new ACM.ACMClient({ ...config, ...(acm ? { endpoint: acm } : {}) }),
		// ACM issues within minutes of seeing the record; DNS decides how many.
		wait: { timeoutMs: 15 * 60_000, intervalMs: 10_000 },
	};
};

let makeCdnClients: CdnClientFactory = defaultCdnClients;

/** Replace the client factory — a test intercepting a call. Returns the old one. */
export function useCdnClients(factory: CdnClientFactory): CdnClientFactory {
	const previous = makeCdnClients;
	makeCdnClients = factory;
	return previous;
}

/** What an AWS SDK error is called, whichever field carries it. */
function errorName(error: unknown): string {
	const e = error as { name?: string; Code?: string };
	return e?.Code ?? e?.name ?? '';
}

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What stands in for an id a dry run would create. */
const PLANNED = '(created by this deploy)';

// ---------------------------------------------------------------------------
// Ensuring
// ---------------------------------------------------------------------------

export interface BucketCdnInput {
	bucket: string;
	region: string;
	servers: readonly CdnServer[];
	/** The stage's sites, for CORS. */
	origins: readonly string[];
}

export interface BucketCdn {
	/** Each distribution's ARN — what the bucket policy grants. */
	distributionArns: string[];
	/** Each file server's public address, by its id. */
	urls: Record<string, string>;
}

/** Each file server over a bucket, behind its own distribution. */
export async function ensureBucketCdn(
	ctx: Ctx,
	input: BucketCdnInput,
): Promise<BucketCdn> {
	const domain = ctx.workspace.domains?.[ctx.stage];
	if (!domain) {
		throw new FileServerCdnNeedsDomain(input.servers[0]!.id, ctx.stage);
	}
	const clients = await makeCdnClients(ctx.credential);
	const out: BucketCdn = { distributionArns: [], urls: {} };
	for (const server of input.servers) {
		const { arn, url } = await ensureServerCdn(ctx, clients, {
			...input,
			server,
			host: cdnHost(server.id, domain),
		});
		out.distributionArns.push(arn);
		out.urls[server.id] = url;
	}
	return out;
}

async function ensureServerCdn(
	ctx: Ctx,
	clients: CdnClients,
	input: BucketCdnInput & { server: CdnServer; host: string },
): Promise<{ arn: string; url: string }> {
	const { server, host } = input;
	const name = cdnName(ctx.identity.scope, ctx.stage, server.id);
	const comment = `gkm ${ctx.identity.key} ${ctx.stage} ${server.id}`.slice(
		0,
		128,
	);

	const certificateArn = await ensureCertificate(ctx, clients, {
		id: server.id,
		host,
		name,
	});
	const originAccessControlId = await ensureOriginAccessControl(ctx, clients, {
		id: server.id,
		name,
		bucket: input.bucket,
	});
	const corsPolicyId =
		input.origins.length > 0
			? await ensureHeadersPolicy(ctx, clients, {
					id: server.id,
					kind: 'cors',
					config: headersPolicyConfig({
						name: `${name}-cors`,
						comment: `${comment}: CORS`,
						origins: input.origins,
						immutable: false,
					}),
				})
			: undefined;
	const immutablePolicyId =
		server.immutable.length > 0
			? await ensureHeadersPolicy(ctx, clients, {
					id: server.id,
					kind: 'immutable',
					config: headersPolicyConfig({
						name: `${name}-immutable`,
						comment: `${comment}: CORS and Cache-Control immutable`,
						origins: input.origins,
						immutable: true,
					}),
				})
			: undefined;

	const distribution = await ensureDistribution(ctx, clients, {
		id: server.id,
		comment,
		config: distributionConfig({
			comment,
			callerReference: name,
			host,
			certificateArn,
			bucketDomain: `${input.bucket}.s3.${input.region}.amazonaws.com`,
			originAccessControlId,
			...(corsPolicyId ? { corsPolicyId } : {}),
			...(immutablePolicyId ? { immutablePolicyId } : {}),
			immutable: server.immutable,
		}),
	});

	if (distribution.domainName !== PLANNED) {
		const written = await ctx.writeDns([
			{ host, type: 'CNAME', value: distribution.domainName },
		]);
		if (written.manual.includes(host)) {
			ctx.log(
				`   ${host} answers once that record exists — ${server.id}'s URL is https://${host}`,
			);
		}
	}
	return { arn: distribution.arn, url: `https://${host}` };
}

/** The certificate for `host`: recorded, adopted, or requested — then issued. */
async function ensureCertificate(
	ctx: Ctx,
	clients: CdnClients,
	input: { id: string; host: string; name: string },
): Promise<string> {
	const { ACM, acm } = clients;
	const { id, host } = input;
	const entry: StateEntry = {
		key: `acm-certificate:${id}`,
		type: 'acm-certificate',
		data: { host },
	};
	const describe = (arn: string) =>
		readOr(
			() =>
				acm.send(new ACM.DescribeCertificateCommand({ CertificateArn: arn })),
			['ResourceNotFoundException'],
		).then((out) => out?.Certificate);

	let arn: string | undefined;
	const recorded = ctx.state.record(entry.key);
	if (recorded?.id && recorded.data?.host === host) {
		const found = await describe(recorded.id);
		const usable =
			found &&
			found.Status !== 'FAILED' &&
			found.Status !== 'VALIDATION_TIMED_OUT' &&
			found.Status !== 'REVOKED' &&
			found.Status !== 'EXPIRED';
		if (usable) arn = recorded.id;
	}
	if (!arn) {
		arn = await findCertificate(clients, host);
		if (arn) ctx.log(`   adopting the certificate for ${host} — ${arn}`);
	}
	if (!arn) {
		if (ctx.dryRun) {
			await ctx.change(
				{
					construct: id,
					resource: `certificate ${host}`,
					change: 'request (ACM, us-east-1, DNS-validated)',
				},
				async () => {},
			);
			return PLANNED;
		}
		await ctx.state.pending(entry);
		const requested = await acm.send(
			new ACM.RequestCertificateCommand({
				DomainName: host,
				ValidationMethod: 'DNS',
				IdempotencyToken: input.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 32),
				Tags: identityTags(ctx, id).map((t) => ({
					Key: t.Key,
					Value: t.Value,
				})),
			}),
		);
		arn = requested.CertificateArn!;
		await ctx.change(
			{
				construct: id,
				resource: `certificate ${host}`,
				change: 'request (ACM, us-east-1, DNS-validated)',
			},
			async () => {},
		);
	}
	if (!ctx.dryRun) await ctx.state.ready(entry, arn);

	// ACM publishes the validation record moments after the request.
	let certificate = await describe(arn);
	let record = certificate?.DomainValidationOptions?.[0]?.ResourceRecord;
	for (let i = 0; !record && i < 15; i++) {
		await sleep(Math.min(clients.wait.intervalMs, 2000));
		certificate = await describe(arn);
		record = certificate?.DomainValidationOptions?.[0]?.ResourceRecord;
	}
	// Written whether or not it is issued: ACM renews against the same record.
	const validation = record
		? {
				name: record.Name!.replace(/\.$/, ''),
				value: record.Value!.replace(/\.$/, ''),
			}
		: undefined;
	const written = validation
		? await ctx.writeDns([
				{ host: validation.name, type: 'CNAME', value: validation.value },
			])
		: { manual: [] };

	if (certificate?.Status === 'ISSUED' || ctx.dryRun) return arn;
	if (validation && written.manual.includes(validation.name.toLowerCase())) {
		throw new CdnCertificatePending(id, host, validation, 'manual');
	}

	ctx.log(`   waiting for ACM to issue the certificate for ${host}…`);
	const deadline = Date.now() + clients.wait.timeoutMs;
	while (
		certificate?.Status === 'PENDING_VALIDATION' &&
		Date.now() < deadline
	) {
		await sleep(clients.wait.intervalMs);
		certificate = await describe(arn);
	}
	if (certificate?.Status === 'ISSUED') return arn;
	if (certificate?.Status === 'PENDING_VALIDATION' || !certificate) {
		throw new CdnCertificatePending(
			id,
			host,
			validation ?? { name: `(not published yet) ${host}`, value: '' },
			'timeout',
		);
	}
	throw new CdnCertificateFailed(
		id,
		host,
		certificate.Status ?? 'unknown',
		certificate.FailureReason,
	);
}

/** An issued or pending certificate for exactly `host`, if the account has one. */
async function findCertificate(
	clients: CdnClients,
	host: string,
): Promise<string | undefined> {
	const { ACM, acm } = clients;
	let NextToken: string | undefined;
	do {
		const page = await acm.send(
			new ACM.ListCertificatesCommand({
				CertificateStatuses: ['ISSUED', 'PENDING_VALIDATION'],
				...(NextToken ? { NextToken } : {}),
			}),
		);
		const match = page.CertificateSummaryList?.find(
			(c) => c.DomainName?.toLowerCase() === host,
		);
		if (match?.CertificateArn) return match.CertificateArn;
		NextToken = page.NextToken;
	} while (NextToken);
	return undefined;
}

/** The origin access control CloudFront signs its bucket requests with. */
async function ensureOriginAccessControl(
	ctx: Ctx,
	clients: CdnClients,
	input: { id: string; name: string; bucket: string },
): Promise<string> {
	const { CF, cloudfront } = clients;
	const entry: StateEntry = {
		key: `cloudfront-oac:${input.id}`,
		type: 'cloudfront-oac',
		data: { name: input.name },
	};
	const recorded = ctx.state.record(entry.key)?.id;
	if (recorded) {
		const found = await readOr(
			() =>
				cloudfront.send(new CF.GetOriginAccessControlCommand({ Id: recorded })),
			['NoSuchOriginAccessControl'],
		);
		if (found) return recorded;
	}

	let Marker: string | undefined;
	do {
		const page = await cloudfront.send(
			new CF.ListOriginAccessControlsCommand({ ...(Marker ? { Marker } : {}) }),
		);
		const match = page.OriginAccessControlList?.Items?.find(
			(o) => o.Name === input.name,
		);
		if (match?.Id) {
			if (!ctx.dryRun) await ctx.state.ready(entry, match.Id);
			return match.Id;
		}
		Marker = page.OriginAccessControlList?.NextMarker;
	} while (Marker);

	let id = PLANNED;
	await ctx.change(
		{
			construct: input.id,
			resource: `origin access control ${input.name}`,
			change: `create (CloudFront signs its reads of ${input.bucket})`,
		},
		async () => {
			await ctx.state.pending(entry);
			const created = await cloudfront.send(
				new CF.CreateOriginAccessControlCommand({
					OriginAccessControlConfig: {
						Name: input.name,
						Description: `gkm: CloudFront's reads of ${input.bucket}`,
						OriginAccessControlOriginType: 's3',
						SigningBehavior: 'always',
						SigningProtocol: 'sigv4',
					},
				}),
			);
			id = created.OriginAccessControl!.Id!;
			await ctx.state.ready(entry, id);
		},
	);
	return id;
}

/** One response headers policy, as wanted. */
async function ensureHeadersPolicy(
	ctx: Ctx,
	clients: CdnClients,
	input: { id: string; kind: string; config: ResponseHeadersPolicyConfig },
): Promise<string> {
	const { CF, cloudfront } = clients;
	const { config } = input;
	const entry: StateEntry = {
		key: `cloudfront-headers:${input.id}:${input.kind}`,
		type: 'cloudfront-headers',
		data: { name: config.Name },
	};
	const read = (Id: string) =>
		readOr(
			() =>
				cloudfront.send(new CF.GetResponseHeadersPolicyConfigCommand({ Id })),
			['NoSuchResponseHeadersPolicy'],
		);

	let id = ctx.state.record(entry.key)?.id;
	let current = id ? await read(id) : undefined;
	if (!current) {
		id = undefined;
		let Marker: string | undefined;
		do {
			const page = await cloudfront.send(
				new CF.ListResponseHeadersPoliciesCommand({
					Type: 'custom',
					...(Marker ? { Marker } : {}),
				}),
			);
			const match = page.ResponseHeadersPolicyList?.Items?.find(
				(p) =>
					p.ResponseHeadersPolicy?.ResponseHeadersPolicyConfig?.Name ===
					config.Name,
			);
			if (match?.ResponseHeadersPolicy?.Id) {
				id = match.ResponseHeadersPolicy.Id;
				current = await read(id);
			}
			Marker = page.ResponseHeadersPolicyList?.NextMarker;
		} while (!id && Marker);
	}

	if (id && current) {
		if (!ctx.dryRun) await ctx.state.ready(entry, id);
		if (sameHeadersPolicy(current.ResponseHeadersPolicyConfig, config)) {
			return id;
		}
		const existing = id;
		await ctx.change(
			{
				construct: input.id,
				resource: `response headers policy ${config.Name}`,
				change: 'put back what drifted',
			},
			async () => {
				await cloudfront.send(
					new CF.UpdateResponseHeadersPolicyCommand({
						Id: existing,
						IfMatch: current!.ETag,
						ResponseHeadersPolicyConfig: config,
					}),
				);
			},
		);
		return existing;
	}

	let created = PLANNED;
	await ctx.change(
		{
			construct: input.id,
			resource: `response headers policy ${config.Name}`,
			change: 'create',
		},
		async () => {
			await ctx.state.pending(entry);
			const out = await cloudfront.send(
				new CF.CreateResponseHeadersPolicyCommand({
					ResponseHeadersPolicyConfig: config,
				}),
			);
			created = out.ResponseHeadersPolicy!.Id!;
			await ctx.state.ready(entry, created);
		},
	);
	return created;
}

/** The distribution: recorded, found by its comment, or created — as wanted. */
async function ensureDistribution(
	ctx: Ctx,
	clients: CdnClients,
	input: { id: string; comment: string; config: DistributionConfig },
): Promise<{ arn: string; domainName: string }> {
	const { CF, cloudfront } = clients;
	const entry: StateEntry = {
		key: `cloudfront-distribution:${input.id}`,
		type: 'cloudfront-distribution',
	};
	const get = (Id: string) =>
		readOr(
			() => cloudfront.send(new CF.GetDistributionCommand({ Id })),
			['NoSuchDistribution'],
		);

	let found = ctx.state.record(entry.key)?.id
		? await get(ctx.state.record(entry.key)!.id!)
		: undefined;
	if (!found) {
		let Marker: string | undefined;
		do {
			const page = await cloudfront.send(
				new CF.ListDistributionsCommand({ ...(Marker ? { Marker } : {}) }),
			);
			const match = page.DistributionList?.Items?.find(
				(d) => d.Comment === input.comment,
			);
			if (match?.Id) found = await get(match.Id);
			Marker = page.DistributionList?.NextMarker;
		} while (!found && Marker);
	}

	if (found?.Distribution) {
		const distribution = found.Distribution;
		const id = distribution.Id!;
		const located = {
			arn: distribution.ARN!,
			domainName: distribution.DomainName!,
		};
		if (!ctx.dryRun) {
			await ctx.state.ready({ ...entry, data: located }, id);
		}
		const current = await cloudfront.send(
			new CF.GetDistributionConfigCommand({ Id: id }),
		);
		if (holds(current.DistributionConfig, input.config)) return located;
		await ctx.change(
			{
				construct: input.id,
				resource: `distribution ${id}`,
				change: 'put back what drifted',
			},
			async () => {
				await cloudfront.send(
					new CF.UpdateDistributionCommand({
						Id: id,
						IfMatch: current.ETag,
						// What else it holds — logging, a WAF — kept.
						DistributionConfig: {
							...current.DistributionConfig!,
							...input.config,
							CallerReference: current.DistributionConfig!.CallerReference,
						},
					}),
				);
			},
		);
		return located;
	}

	let created = {
		arn: `arn:aws:cloudfront::${PLANNED}`,
		domainName: PLANNED,
	};
	const host = input.config.Aliases?.Items?.[0] ?? input.id;
	await ctx.change(
		{
			construct: input.id,
			resource: `distribution ${host}`,
			change: 'create (CloudFront, takes minutes to reach every edge)',
		},
		async () => {
			await ctx.state.pending(entry);
			const out = await cloudfront.send(
				new CF.CreateDistributionWithTagsCommand({
					DistributionConfigWithTags: {
						DistributionConfig: input.config,
						Tags: {
							Items: identityTags(ctx, input.id).map((t) => ({
								Key: t.Key,
								Value: t.Value,
							})),
						},
					},
				}),
			);
			created = {
				arn: out.Distribution!.ARN!,
				domainName: out.Distribution!.DomainName!,
			};
			await ctx.state.ready({ ...entry, data: created }, out.Distribution!.Id!);
		},
	);
	return created;
}
