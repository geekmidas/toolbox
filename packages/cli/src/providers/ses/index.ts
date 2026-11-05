/**
 * The `ses` provider: what receives an inbox's mail on a deployed stage.
 *
 * `deploy.inbox.<stage> = { provider: 'ses', region? }` has the deploy create,
 * for each `Inbox`:
 *
 * - **its own bucket** — never one the stack or `deploy.objects` runs — by
 *   the steps every bucket of the stage takes (`ensureOwnedBucket`), with SES
 *   allowed to write under `messages/` and an IAM user of its own whose key
 *   is the inbox's `<ID>_URL`;
 * - **its topic** on SNS, publishable by SES alone, whose `sns://` address —
 *   signed by the same key — is the topic's connection string. The deploy's
 *   push subscriptions for a topic on SNS (`topicPushes`) then subscribe each
 *   inbox subscriber at its worker's route, unfiltered;
 * - **the stage's domain as an SES identity**, verified through Easy DKIM's
 *   CNAMEs, and **MX records** pointing the domain — or every subdomain of it,
 *   with `subdomains: true` — at the region's inbound endpoint, both through
 *   the stage's DNS;
 * - **a receipt rule** in the region's *active* rule set: the inbox's
 *   recipients, stored under `messages/` and announced on its topic. Never a
 *   new set made active over another — only one is active per region, and
 *   switching would stop every other stage's and app's rules. A set is made
 *   active only where none is.
 *
 * A removed inbox's rule is deleted on the next deploy, by its name; nothing
 * else this provider did not make is touched.
 */

import {
	type ConstructManifest,
	INBOX_MESSAGES_PREFIX,
	type InboxDeclaration,
	providedKeyFor,
	receiptRecipients,
} from '@geekmidas/manifest';
import { NoDomainForStage } from '../../target/dokploy/domain.js';
import { appKey } from '../../workspace/derive.js';
import {
	type AwsProvisioning,
	awsClientConfig,
	awsEndpoint,
	awsProvisioningCredentials,
} from '../aws.js';
import { ensureEventsKey, ensureTopic, eventsClients } from '../s3/events.js';
import { ensureOwnedBucket, s3Region } from '../s3/index.js';
import type { PolicyDocument } from '../s3/policy.js';
import type {
	EnsureContext,
	ResourceProvider,
	VerifyContext,
} from '../types.js';
import {
	checkSesConfig,
	inboxBucketId,
	inboxTopicName,
	SES_PROVISIONING,
	type SesInboxConfig,
} from './config.js';
import { InboxNotProvisioned, SesReceivingUnsupported } from './errors.js';

type Ctx = EnsureContext<SesInboxConfig, AwsProvisioning>;
type SesModule = typeof import('@aws-sdk/client-ses');

/**
 * The regions SES receives mail in, each at `inbound-smtp.<region>.amazonaws.com`
 * — the AWS General Reference's "Email Receiving endpoints".
 */
export const SES_RECEIVING_REGIONS: readonly string[] = [
	'us-east-1',
	'us-east-2',
	'us-west-1',
	'us-west-2',
	'af-south-1',
	'ap-southeast-3',
	'ap-south-1',
	'ap-northeast-3',
	'ap-northeast-2',
	'ap-southeast-1',
	'ap-southeast-2',
	'ap-northeast-1',
	'ca-central-1',
	'eu-central-1',
	'eu-west-1',
	'eu-west-2',
	'eu-south-1',
	'eu-west-3',
	'eu-north-1',
	'il-central-1',
	'me-south-1',
	'sa-east-1',
];

/** Where mail for a domain is delivered in `region`: its MX target. */
export function inboundEndpoint(region: string): string {
	return `inbound-smtp.${region}.amazonaws.com`;
}

/** The rule set made active where a region has none. */
export const DEFAULT_RULE_SET = 'gkm';

/** Every inbox in the manifest. */
export function inboxConstructs(
	manifest: ConstructManifest,
): InboxDeclaration[] {
	return Object.values(manifest)
		.filter((d): d is InboxDeclaration => d.kind === 'inbox')
		.sort((a, b) => a.id.localeCompare(b.id));
}

/** The name an inbox's receipt rule has: the prefix it is found by, and its id. */
export function receiptRuleName(
	scope: string,
	stage: string,
	inbox: string,
): string {
	return `${rulePrefix(scope, stage)}${appKey(inbox)}`.slice(0, 64);
}

/** What every rule this stage made is named with. */
function rulePrefix(scope: string, stage: string): string {
	return `gkm-${scope}-${stage}-`.replace(/[^A-Za-z0-9_.-]/g, '-');
}

/** The topic SES announces an inbox's mail on: publishable by SES, from this account. */
export function receiptTopicPolicy(
	topicArn: string,
	account: string,
): PolicyDocument {
	return {
		Version: '2012-10-17',
		Statement: [
			{
				Sid: 'GkmSesPublishes',
				Effect: 'Allow',
				Principal: { Service: 'ses.amazonaws.com' },
				Action: 'sns:Publish',
				Resource: topicArn,
				Condition: { StringEquals: { 'aws:SourceAccount': account } },
			},
		],
	};
}

export interface SesClients {
	SES: SesModule;
	ses: InstanceType<SesModule['SESClient']>;
}

/** Clients for SES, for tests to replace. */
export type SesClientFactory = (
	credential: AwsProvisioning,
	region: string,
) => Promise<SesClients>;

export const defaultSesClients: SesClientFactory = async (
	credential,
	region,
) => {
	const SES = await import('@aws-sdk/client-ses');
	const config = await awsClientConfig(credential, region);
	const endpoint = awsEndpoint(process.env, 'SES');
	return {
		SES,
		ses: new SES.SESClient({ ...config, ...(endpoint ? { endpoint } : {}) }),
	};
};

let makeSesClients: SesClientFactory = defaultSesClients;

/** The stage's SES, through the factory a test may replace. */
export function sesClients(
	credential: AwsProvisioning,
	region: string,
): Promise<SesClients> {
	return makeSesClients(credential, region);
}

/** Replace the client factory — a test intercepting a call. Returns the old one. */
export function useSesClients(factory: SesClientFactory): SesClientFactory {
	const previous = makeSesClients;
	makeSesClients = factory;
	return previous;
}

function errorName(error: unknown): string {
	const e = error as { name?: string; Code?: string; code?: string };
	return e?.name ?? e?.Code ?? e?.code ?? '';
}

/** The stage's domain, which every inbox receives on. */
function stageDomain(ctx: Pick<Ctx, 'workspace' | 'stage'>): string {
	const domain = ctx.workspace.domains?.[ctx.stage];
	if (!domain) throw new NoDomainForStage(ctx.stage);
	return domain;
}

async function ensureSes(ctx: Ctx): Promise<void> {
	const region = s3Region(ctx as never);
	if (!SES_RECEIVING_REGIONS.includes(region)) {
		throw new SesReceivingUnsupported(ctx.stage, region, SES_RECEIVING_REGIONS);
	}
	const inboxes = inboxConstructs(ctx.manifest);
	const { SES, ses } = await makeSesClients(ctx.credential, region);
	try {
		const ruleSet = await activeRuleSet(ctx, { SES, ses }, inboxes.length > 0);
		if (inboxes.length > 0) {
			const domain = stageDomain(ctx);
			await ensureIdentity(ctx, { SES, ses }, domain);
			const events = await eventsClients(ctx.credential, region);
			try {
				for (const inbox of inboxes) {
					await ensureInbox(ctx, { SES, ses }, events, {
						inbox,
						domain,
						region,
						ruleSet: ruleSet!,
					});
				}
			} finally {
				events.sns.destroy();
				events.sqs.destroy();
			}
			await ensureMx(ctx, inboxes, domain, region);
		}
		if (ruleSet) await retireRules(ctx, { SES, ses }, ruleSet, inboxes);
	} finally {
		ses.destroy();
	}
}

/**
 * The region's active rule set. Made — and made active — only where none is
 * active and an inbox needs one: activating a set deactivates whichever was.
 */
async function activeRuleSet(
	ctx: Ctx,
	{ SES, ses }: SesClients,
	needed: boolean,
): Promise<string | undefined> {
	const active = await ses.send(
		new SES.DescribeActiveReceiptRuleSetCommand({}),
	);
	const name = active.Metadata?.Name;
	if (name || !needed) return name;

	await ctx.change(
		{
			construct: 'inbox',
			resource: `SES receipt rule set ${DEFAULT_RULE_SET}`,
			change: 'create and make active — the region has none',
		},
		async () => {
			try {
				await ses.send(
					new SES.CreateReceiptRuleSetCommand({
						RuleSetName: DEFAULT_RULE_SET,
					}),
				);
			} catch (error) {
				if (errorName(error) !== 'AlreadyExistsException') throw error;
			}
			await ses.send(
				new SES.SetActiveReceiptRuleSetCommand({
					RuleSetName: DEFAULT_RULE_SET,
				}),
			);
		},
	);
	return DEFAULT_RULE_SET;
}

/**
 * The stage's domain as an SES identity, verified by Easy DKIM: its three
 * CNAMEs, through the stage's DNS. Receiving requires a verified domain.
 */
async function ensureIdentity(
	ctx: Ctx,
	{ SES, ses }: SesClients,
	domain: string,
): Promise<void> {
	let tokens: string[] = [];
	await ctx.change(
		{
			construct: 'inbox',
			resource: `SES identity ${domain}`,
			change: 'verify with DKIM',
		},
		async () => {
			const dkim = await ses.send(
				new SES.VerifyDomainDkimCommand({ Domain: domain }),
			);
			tokens = dkim.DkimTokens ?? [];
		},
	);
	if (tokens.length === 0) return;
	await ctx.writeDns(
		tokens.map((token) => ({
			host: `${token}._domainkey.${domain}`,
			type: 'CNAME' as const,
			value: `${token}.dkim.amazonses.com`,
		})),
	);
}

/** One inbox: its bucket, its topic and their keys, and its receipt rule. */
async function ensureInbox(
	ctx: Ctx,
	{ SES, ses }: SesClients,
	events: Awaited<ReturnType<typeof eventsClients>>,
	input: {
		inbox: InboxDeclaration;
		domain: string;
		region: string;
		ruleSet: string;
	},
): Promise<void> {
	const { inbox, domain, region, ruleSet } = input;
	const name = inboxBucketId(inbox.id);
	const urlKey = providedKeyFor(inbox.id, inbox.kind, 'url');

	const topicArn = await ensureTopic(ctx as never, events, {
		id: inbox.id,
		topicName: inboxTopicName(ctx.identity.scope, ctx.stage, inbox.id),
		publisher: 'SES',
		policy: (arn) => receiptTopicPolicy(arn, events.account),
	});

	const { bucket } = await ensureOwnedBucket(ctx, {
		id: inbox.id,
		name,
		urlKey,
		sesWrite: { prefix: INBOX_MESSAGES_PREFIX, account: events.account },
		topicArn,
	});

	await ensureEventsKey(ctx, {
		id: inbox.id,
		topicArn,
		region,
		key: providedKeyFor(inbox.topic, 'topic', 'publisherConnectionString'),
		urlKey,
	});

	const rule = {
		Name: receiptRuleName(ctx.identity.scope, ctx.stage, inbox.id),
		Enabled: true,
		TlsPolicy: 'Optional' as const,
		ScanEnabled: true,
		Recipients: receiptRecipients(inbox, domain),
		Actions: [
			{
				S3Action: {
					BucketName: bucket,
					ObjectKeyPrefix: INBOX_MESSAGES_PREFIX,
					TopicArn: topicArn,
				},
			},
		],
	};
	const current = await ses
		.send(
			new SES.DescribeReceiptRuleCommand({
				RuleSetName: ruleSet,
				RuleName: rule.Name,
			}),
		)
		.then(
			(found) => found.Rule,
			(error) => {
				if (errorName(error) === 'RuleDoesNotExistException') return undefined;
				throw error;
			},
		);
	const entry = {
		key: `ses-receipt-rule:${inbox.id}`,
		type: 'ses-receipt-rule',
	};
	if (current && sameRule(current, rule)) {
		await ctx.state.ready(entry, rule.Name);
		return;
	}
	await ctx.change(
		{
			construct: inbox.id,
			resource: `SES receipt rule ${rule.Name}`,
			change: current
				? `receive at ${rule.Recipients.join(', ')}`
				: `create, receiving at ${rule.Recipients.join(', ')}`,
		},
		async () => {
			await ctx.state.pending(entry);
			await ses.send(
				current
					? new SES.UpdateReceiptRuleCommand({
							RuleSetName: ruleSet,
							Rule: rule,
						})
					: new SES.CreateReceiptRuleCommand({
							RuleSetName: ruleSet,
							Rule: rule,
						}),
			);
			await ctx.state.ready(entry, rule.Name);
		},
	);
}

function sameRule(
	current: {
		Enabled?: boolean;
		TlsPolicy?: string;
		ScanEnabled?: boolean;
		Recipients?: string[];
		Actions?: {
			S3Action?: {
				BucketName?: string;
				ObjectKeyPrefix?: string;
				TopicArn?: string;
			};
		}[];
	},
	wanted: {
		Enabled: boolean;
		TlsPolicy: string;
		ScanEnabled: boolean;
		Recipients: string[];
		Actions: {
			S3Action: {
				BucketName: string;
				ObjectKeyPrefix: string;
				TopicArn: string;
			};
		}[];
	},
): boolean {
	const s3 = current.Actions?.[0]?.S3Action;
	const want = wanted.Actions[0]!.S3Action;
	return (
		current.Enabled === wanted.Enabled &&
		current.TlsPolicy === wanted.TlsPolicy &&
		current.ScanEnabled === wanted.ScanEnabled &&
		current.Actions?.length === 1 &&
		s3?.BucketName === want.BucketName &&
		s3?.ObjectKeyPrefix === want.ObjectKeyPrefix &&
		s3?.TopicArn === want.TopicArn &&
		[...(current.Recipients ?? [])].sort().join() ===
			[...wanted.Recipients].sort().join()
	);
}

/**
 * MX records for the stage's domain — and, for an inbox on its tenants'
 * subdomains, for every subdomain — at the region's inbound endpoint.
 */
async function ensureMx(
	ctx: Ctx,
	inboxes: readonly InboxDeclaration[],
	domain: string,
	region: string,
): Promise<void> {
	const hosts = new Set<string>();
	for (const inbox of inboxes) {
		hosts.add(inbox.subdomains ? `*.${domain}` : domain);
	}
	await ctx.writeDns(
		[...hosts].sort().map((host) => ({
			host,
			type: 'MX' as const,
			value: inboundEndpoint(region),
			priority: 10,
		})),
	);
}

/** Delete the rules this stage made for inboxes no longer declared — only those. */
async function retireRules(
	ctx: Ctx,
	{ SES, ses }: SesClients,
	ruleSet: string,
	inboxes: readonly InboxDeclaration[],
): Promise<void> {
	const prefix = rulePrefix(ctx.identity.scope, ctx.stage);
	const kept = new Set(
		inboxes.map((inbox) =>
			receiptRuleName(ctx.identity.scope, ctx.stage, inbox.id),
		),
	);
	const set = await ses.send(
		new SES.DescribeReceiptRuleSetCommand({ RuleSetName: ruleSet }),
	);
	for (const rule of set.Rules ?? []) {
		if (!rule.Name?.startsWith(prefix) || kept.has(rule.Name)) continue;
		await ctx.change(
			{
				construct: 'inbox',
				resource: `SES receipt rule ${rule.Name}`,
				change: 'delete — its inbox is no longer declared',
			},
			async () => {
				await ses.send(
					new SES.DeleteReceiptRuleCommand({
						RuleSetName: ruleSet,
						RuleName: rule.Name!,
					}),
				);
			},
		);
	}
}

/**
 * The cheap check every deploy runs: the region receives mail, the stage has
 * a domain, and each inbox's keys are in the stage's secrets.
 */
async function verifySes(ctx: VerifyContext<SesInboxConfig>): Promise<void> {
	const region = s3Region(ctx as never);
	if (!SES_RECEIVING_REGIONS.includes(region)) {
		throw new SesReceivingUnsupported(ctx.stage, region, SES_RECEIVING_REGIONS);
	}
	const inboxes = inboxConstructs(ctx.manifest);
	if (inboxes.length === 0) return;
	stageDomain(ctx);
	for (const inbox of inboxes) {
		const missing = [
			providedKeyFor(inbox.id, inbox.kind, 'url'),
			providedKeyFor(inbox.topic, 'topic', 'publisherConnectionString'),
		].filter((key) => ctx.secrets[key] === undefined);
		if (missing.length > 0) {
			throw new InboxNotProvisioned(ctx.stage, inbox.id, missing);
		}
	}
}

export const sesProvider: ResourceProvider<SesInboxConfig, AwsProvisioning> = {
	kind: 'inbox',
	name: 'ses',
	check: checkSesConfig,
	provisioning: SES_PROVISIONING,
	credentials: awsProvisioningCredentials,
	runtimeKeys(manifest) {
		return inboxConstructs(manifest).flatMap((inbox) => [
			providedKeyFor(inbox.id, inbox.kind, 'url'),
			providedKeyFor(inbox.topic, 'topic', 'publisherConnectionString'),
		]);
	},
	ensure: ensureSes,
	verify: verifySes,
};
