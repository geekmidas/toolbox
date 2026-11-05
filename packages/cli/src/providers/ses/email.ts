/**
 * The `ses` provider for mail: what sends an `Email` construct's mail on a
 * deployed stage.
 *
 * `deploy.email.<stage> = { provider: 'ses', region?, from? }` has the deploy
 * create, in the stage's AWS account:
 *
 * - **the sender's domain as an SES identity**, verified through Easy DKIM's
 *   CNAMEs written through the stage's DNS — the same identity an inbox on
 *   that domain uses: SES has one per domain, and neither provider deletes it;
 * - for each mail construct, **an IAM user** allowed `ses:SendRawEmail` from
 *   that identity and nothing else, and **its access key**, written into the
 *   stage's secrets as `<ID>_URL` — `smtp://<key id>:<smtp password>@
 *   email-smtp.<region>.amazonaws.com:587`, the password derived from the key;
 * - **`<ID>_FROM`**: `from`, else what the secrets hold, else `noreply@` the
 *   stage's domain.
 *
 * A `<ID>_URL` the stage's secrets already hold, and this provider did not
 * write, wins: the construct sends with it and nothing is created for it — an
 * identity that already has sending credentials is not given a second set.
 * Moving an existing stack onto compose stays a `secrets:import`.
 *
 * `--rotate-keys` issues each user a successor key, and with it a new
 * password, as every other provider's keys are rotated.
 */

import {
	type ConstructManifest,
	type EmailDeclaration,
	provideKey,
} from '@geekmidas/manifest';
import {
	type AwsProvisioning,
	awsClientConfig,
	awsEndpoint,
	awsProvisioningCredentials,
} from '../aws.js';
import { ensureAccessKey, ensureIamUser, type IamClients } from '../iam.js';
import { callerAccountId } from '../projectBucket.js';
import { s3Region } from '../s3/index.js';
import type { PolicyDocument } from '../s3/policy.js';
import type {
	EnsureContext,
	ResourceProvider,
	VerifyContext,
} from '../types.js';
import {
	checkSesEmailConfig,
	emailUserName,
	SES_PROVISIONING,
	type SesEmailConfig,
} from './config.js';
import { EmailNotProvisioned, EmailSenderUnknown } from './errors.js';
import { type SesClients, sesClients } from './index.js';
import { smtpKeySecret, smtpUser } from './smtp.js';

type Ctx = EnsureContext<SesEmailConfig, AwsProvisioning>;

/** The inline policy each sending user is given. */
export const SEND_POLICY_NAME = 'gkm-email';

/**
 * The most a sandboxed account sends in a day. An account with no more is
 * taken to be in the sandbox, where SES delivers only to verified addresses.
 */
const SANDBOX_DAILY_QUOTA = 200;

/** Every mail construct in the manifest. */
export function emailConstructs(
	manifest: ConstructManifest,
): EmailDeclaration[] {
	return Object.values(manifest)
		.filter((d): d is EmailDeclaration => d.kind === 'email')
		.sort((a, b) => a.id.localeCompare(b.id));
}

/** What a sending user may do: send as `identityArn`, and nothing else. */
export function sendPolicy(identityArn: string): PolicyDocument {
	return {
		Version: '2012-10-17',
		Statement: [
			{
				Sid: 'GkmSendEmail',
				Effect: 'Allow',
				Action: 'ses:SendRawEmail',
				Resource: identityArn,
			},
		],
	};
}

/** The ARN of a domain's SES identity. */
export function identityArn(
	region: string,
	account: string,
	domain: string,
): string {
	return `arn:aws:ses:${region}:${account}:identity/${domain}`;
}

/**
 * Whether the stage's secrets hold a URL for `email` that this provider did
 * not write — one set by hand, or imported — which it then leaves alone.
 */
export function urlSetElsewhere(
	ctx: Pick<Ctx, 'secrets' | 'state'>,
	email: string,
): boolean {
	const given = ctx.secrets[provideKey(email, 'url')];
	if (given === undefined) return false;
	const record = ctx.state.record(`iam-access-key:${email}`);
	if (!record) return true;
	const user = smtpUser(given);
	return user !== record.id && user !== record.data?.previous;
}

/** The state entry of the address gkm last wrote as `email`'s sender. */
export function senderEntry(email: string) {
	return { key: `email-from:${email}`, type: 'email-from' };
}

/**
 * The address `email` sends from: `from`; else one the stage's secrets hold
 * that gkm did not write — set by hand, or imported; else `noreply@` the
 * stage's domain. An address gkm wrote follows the domain: after a change of
 * `domains.<stage>`, mail is sent as the new one.
 *
 * @returns the address, and whether it is gkm's to write and record
 * @throws {EmailSenderUnknown} with none of them
 */
export function senderOf(
	ctx: Pick<Ctx, 'config' | 'secrets' | 'workspace' | 'stage' | 'state'>,
	email: string,
): { address: string; ours: boolean } {
	if (ctx.config.from) return { address: ctx.config.from, ours: true };
	const held = ctx.secrets[provideKey(email, 'from')];
	const wrote = ctx.state.record(senderEntry(email).key)?.id;
	const domain = ctx.workspace.domains?.[ctx.stage];
	const fallback = domain ? `noreply@${domain}` : undefined;
	// Not recorded and not the default: someone else's choice, kept.
	if (held && held !== wrote && held !== fallback) {
		return { address: held, ours: false };
	}
	if (fallback) return { address: fallback, ours: true };
	if (held) return { address: held, ours: false };
	throw new EmailSenderUnknown(ctx.stage);
}

/** The domain of an address — `noreply@x.com` or `Acme <noreply@x.com>`. */
export function domainOf(address: string): string {
	return address
		.slice(address.lastIndexOf('@') + 1)
		.replace(/>\s*$/, '')
		.trim()
		.toLowerCase();
}

async function iamClients(
	credential: AwsProvisioning,
	region: string,
): Promise<IamClients & { sts: import('@aws-sdk/client-sts').STSClient }> {
	const IAM = await import('@aws-sdk/client-iam');
	const { STSClient } = await import('@aws-sdk/client-sts');
	const config = await awsClientConfig(credential, region);
	const stsEndpoint = awsEndpoint(process.env, 'STS');
	return {
		IAM,
		iam: new IAM.IAMClient(config),
		sts: new STSClient({
			...config,
			...(stsEndpoint ? { endpoint: stsEndpoint } : {}),
		}),
		region,
	};
}

async function ensureSesEmail(ctx: Ctx): Promise<void> {
	const emails = emailConstructs(ctx.manifest);
	const owned = emails.filter((email) => {
		if (!urlSetElsewhere(ctx, email.id)) return true;
		ctx.log(
			`   ${email.id}: ${provideKey(email.id, 'url')} is set in the stage's secrets — it sends with that, and nothing is created for it`,
		);
		return false;
	});
	if (owned.length === 0) return;

	const region = s3Region(ctx as never);
	const senders = new Map(owned.map((e) => [e.id, senderOf(ctx, e.id)]));
	const domains = [
		...new Set([...senders.values()].map((s) => domainOf(s.address))),
	].sort();

	const ses = await sesClients(ctx.credential, region);
	const clients = await iamClients(ctx.credential, region);
	try {
		const account = await callerAccountId(clients.sts);
		for (const domain of domains) await ensureIdentity(ctx, ses, domain);
		await noteSandbox(ctx, ses, region);

		for (const email of owned) {
			const { address: from, ours } = senders.get(email.id)!;
			const domain = domainOf(from);
			const user = await ensureIamUser(ctx, clients, {
				id: email.id,
				user: emailUserName(ctx.identity.scope, ctx.stage, email.id),
				policyName: SEND_POLICY_NAME,
				policy: sendPolicy(identityArn(region, account, domain)),
				describe: `send as ${domain} only`,
			});
			await ensureAccessKey(ctx, clients, {
				id: email.id,
				secret: smtpKeySecret(provideKey(email.id, 'url'), region),
				...user,
			});
			const fromKey = provideKey(email.id, 'from');
			if (ctx.secrets[fromKey] !== from) {
				await ctx.change(
					{ construct: email.id, resource: fromKey, change: `set to ${from}` },
					() => ctx.writeSecrets({ [fromKey]: from }),
				);
			}
			// What gkm chose is recorded, so the next deploy knows it may
			// replace it — a change of domain moves the sender with it.
			if (ours && ctx.state.record(senderEntry(email.id).key)?.id !== from) {
				await ctx.state.ready(senderEntry(email.id), from);
			}
		}
	} finally {
		ses.ses.destroy();
		clients.iam.destroy();
		clients.sts.destroy();
	}
}

/**
 * The domain as an SES identity that signs what it sends with Easy DKIM: its
 * three CNAMEs, through the stage's DNS.
 *
 * The check is DKIM's own status, not the domain's: a domain verified by its
 * older TXT record is verified, and sends unsigned until DKIM is set up on it.
 * One whose DKIM is verified is left as it is, signing turned back on if it
 * was turned off; any other — new, verified only by TXT, or created by
 * another stack and never finished — is asked for its tokens, which SES
 * answers without making a second identity.
 */
export async function ensureIdentity(
	ctx: Pick<Ctx, 'change' | 'writeDns' | 'log'>,
	{ SES, ses }: SesClients,
	domain: string,
): Promise<void> {
	const { DkimAttributes } = await ses.send(
		new SES.GetIdentityDkimAttributesCommand({ Identities: [domain] }),
	);
	const dkim = DkimAttributes?.[domain];
	const verified = dkim?.DkimVerificationStatus === 'Success';
	let tokens = dkim?.DkimTokens ?? [];
	if (verified && !dkim.DkimEnabled) {
		await ctx.change(
			{
				construct: 'email',
				resource: `SES identity ${domain}`,
				change: 'turn DKIM signing back on',
			},
			async () => {
				await ses.send(
					new SES.SetIdentityDkimEnabledCommand({
						Identity: domain,
						DkimEnabled: true,
					}),
				);
			},
		);
	}
	if (!verified) {
		await ctx.change(
			{
				construct: 'email',
				resource: `SES identity ${domain}`,
				change: 'verify with DKIM',
			},
			async () => {
				const asked = await ses.send(
					new SES.VerifyDomainDkimCommand({ Domain: domain }),
				);
				tokens = asked.DkimTokens ?? tokens;
			},
		);
	}
	if (tokens.length === 0) return;
	// Asked for on every deploy, verified or not: a record no provider asks
	// for is pruned, and DKIM keeps checking these.
	await ctx.writeDns(
		tokens.map((token) => ({
			host: `${token}._domainkey.${domain}`,
			type: 'CNAME' as const,
			value: `${token}.dkim.amazonses.com`,
		})),
	);
	if (verified) return;
	ctx.log(
		`   ${domain}: SES sends as it once its DKIM records resolve — usually minutes, at most 72 hours`,
	);
}

/** Say so when the account is in SES's sandbox, rather than fail on a send. */
async function noteSandbox(
	ctx: Ctx,
	{ SES, ses }: SesClients,
	region: string,
): Promise<void> {
	const quota = await ses.send(new SES.GetSendQuotaCommand({}));
	if ((quota.Max24HourSend ?? 0) > SANDBOX_DAILY_QUOTA) return;
	ctx.log(
		`   ⚠️  SES in ${region} looks to be in the sandbox (${quota.Max24HourSend ?? 0} messages a day): it delivers only to addresses verified in SES. Request production access in the SES console before sending to anyone else.`,
	);
}

/** The cheap check every deploy runs: each mail construct's keys are in the stage's secrets. */
async function verifySesEmail(
	ctx: VerifyContext<SesEmailConfig>,
): Promise<void> {
	for (const email of emailConstructs(ctx.manifest)) {
		const missing = [
			provideKey(email.id, 'url'),
			provideKey(email.id, 'from'),
		].filter((key) => ctx.secrets[key] === undefined);
		if (missing.length > 0) {
			throw new EmailNotProvisioned(ctx.stage, email.id, missing);
		}
	}
}

export const sesEmailProvider: ResourceProvider<
	SesEmailConfig,
	AwsProvisioning
> = {
	kind: 'email',
	name: 'ses',
	check: checkSesEmailConfig,
	provisioning: SES_PROVISIONING,
	credentials: awsProvisioningCredentials,
	runtimeKeys(manifest) {
		return emailConstructs(manifest).flatMap((email) => [
			provideKey(email.id, 'url'),
			provideKey(email.id, 'from'),
		]);
	},
	ensure: ensureSesEmail,
	verify: verifySesEmail,
};
