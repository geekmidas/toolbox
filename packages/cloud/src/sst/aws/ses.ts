import { createHmac } from 'node:crypto';

/**
 * An SES SMTP password, derived from an IAM secret access key.
 *
 * SES does not hand you an SMTP password. It hands you IAM credentials, and the
 * SMTP password is a *signature* computed from the secret access key with a
 * fixed, documented recipe — so provisioning SMTP access means creating a user,
 * creating an access key, and then doing this arithmetic. That is why `email` is
 * the only kind whose provisioner is a chain rather than a component.
 *
 * The recipe is AWS's, verbatim: a SigV4 signing key over the constant date
 * `11111111`, the region, the service `ses`, the terminator `aws4_request`, and
 * the message `SendRawEmail` — then a one-byte version prefix, base64-encoded.
 *
 * Pure, which is the only way this gets checked at all: AWS documents the
 * recipe but publishes no worked example, so there is no golden value to assert
 * against. What the tests do instead is check the properties the recipe implies
 * — the version byte survives, the output is deterministic, and it changes with
 * both the key and the region. A wrong password fails at the first send, long
 * after the stack reported success, so it is worth saying plainly that this has
 * been verified against the documented algorithm and not against SES.
 *
 * @see https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html
 */
export function smtpPassword(secretAccessKey: string, region: string): string {
	// Not every region has an SMTP endpoint, and deriving a password for one
	// that does not produces a credential that can never work — a failure that
	// surfaces at the first send rather than at deploy.
	if (!SMTP_REGIONS.includes(region)) throw new NoSmtpEndpoint(region);

	// The date is a constant, not today's: this is a signing key that never
	// rotates on a schedule, so AWS fixed the date rather than leaving a
	// credential that silently expires.
	const date = sign(`AWS4${secretAccessKey}`, '11111111');
	const regional = sign(date, region);
	const service = sign(regional, 'ses');
	const terminated = sign(service, 'aws4_request');
	const signature = sign(terminated, 'SendRawEmail');

	// The version prefix tells SES which derivation produced the rest. Without
	// it the password is the right bytes and still rejected.
	return Buffer.concat([Buffer.from([VERSION]), signature]).toString('base64');
}

/** The only version AWS has ever published. */
const VERSION = 0x04;

/**
 * The regions with an SES SMTP endpoint.
 *
 * Shorter than the list of regions SES runs in, and shorter still than the list
 * of AWS regions — which is exactly why it is worth checking. AWS's own script
 * raises on a region outside this set rather than returning a password that
 * looks fine.
 */
export const SMTP_REGIONS: readonly string[] = [
	'us-east-2',
	'us-east-1',
	'us-west-2',
	'ap-south-1',
	'ap-northeast-2',
	'ap-southeast-1',
	'ap-southeast-2',
	'ap-northeast-1',
	'ca-central-1',
	'eu-central-1',
	'eu-west-1',
	'eu-west-2',
	'eu-south-1',
	'eu-north-1',
	'sa-east-1',
	'us-gov-west-1',
	'us-gov-east-1',
];

/** SES has no SMTP endpoint in the region an email construct resolved to. */
export class NoSmtpEndpoint extends Error {
	constructor(readonly region: string) {
		super(
			`SES has no SMTP endpoint in ${region}, so no SMTP password derived ` +
				`for it can work. Send from one of: ${SMTP_REGIONS.join(', ')}.`,
		);
		this.name = 'NoSmtpEndpoint';
	}
}

function sign(key: string | Buffer, message: string): Buffer {
	return createHmac('sha256', key).update(message, 'utf8').digest();
}

/**
 * Where SES accepts SMTP in a region.
 *
 * Read off the region rather than configured, for the same reason every other
 * address in this package is: a host somebody types is a host that can be typed
 * wrongly, and this one is derivable.
 */
export function smtpEndpoint(region: string): string {
	return `email-smtp.${region}.amazonaws.com`;
}

/**
 * The submission port.
 *
 * 587 with STARTTLS rather than 465 with implicit TLS: both work, and 587 is the
 * one that is not blocked by default on most networks — including, historically,
 * on EC2.
 */
export const SMTP_PORT = 587;

/**
 * An `smtp://` URL for a set of SES credentials.
 *
 * The same shape Mailpit gets locally and the same shape Resend gets deployed,
 * which is the whole reason the declaration promises `smtp://` and names no
 * provider: what changes between them is a host and a credential, and nothing a
 * client can see.
 */
export function sesSmtpUrl(options: {
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
}): string {
	const password = smtpPassword(options.secretAccessKey, options.region);

	// Encoded, because a base64 password can contain `+` and `/` — both of which
	// mean something else in a URL's authority section.
	return `smtp://${encodeURIComponent(options.accessKeyId)}:${encodeURIComponent(
		password,
	)}@${smtpEndpoint(options.region)}:${SMTP_PORT}`;
}
