import { appKey } from '../../workspace/derive.js';
import { S3_PROVISIONING } from '../s3/config.js';
import { iamUserName } from '../s3/naming.js';
import type { ProviderConfig } from '../types.js';
import { SesProviderConfigInvalid } from './errors.js';

/** `inbox: { provider: 'ses' }` — each inbox received by SES in the stage's account. */
export interface SesInboxConfig {
	provider: 'ses';
	/**
	 * Where mail is received, and the inbox's bucket and topic live. Defaults
	 * to the secrets store's region, then `AWS_REGION` — and must be one SES
	 * receives mail in.
	 */
	region?: string;
}

const FIELDS = ['provider', 'region'] as const;

const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;

export function checkSesConfig(
	stage: string,
	config: ProviderConfig,
): SesInboxConfig {
	const entry = config as unknown as Record<string, unknown>;
	for (const field of Object.keys(entry)) {
		if (!(FIELDS as readonly string[]).includes(field)) {
			throw new SesProviderConfigInvalid(
				'inbox',
				stage,
				field,
				entry[field],
				`the ses provider takes ${FIELDS.slice(1).join(', ')} only`,
			);
		}
	}
	if (
		entry.region !== undefined &&
		(typeof entry.region !== 'string' || !REGION.test(entry.region))
	) {
		throw new SesProviderConfigInvalid(
			'inbox',
			stage,
			'region',
			entry.region,
			"set it to an AWS region code SES receives mail in, like 'eu-west-1'",
		);
	}
	return entry as unknown as SesInboxConfig;
}

/**
 * `email: { provider: 'ses' }` — each mail construct sends through SES's SMTP
 * interface in the stage's account.
 */
export interface SesEmailConfig {
	provider: 'ses';
	/**
	 * Where mail is sent from: the identity, and the SMTP endpoint the URL
	 * names. Defaults to the secrets store's region, then `AWS_REGION`.
	 */
	region?: string;
	/**
	 * The address mail is sent from — what `<ID>_FROM` holds. Its domain is
	 * the SES identity the deploy verifies. Defaults to `noreply@` the
	 * stage's domain.
	 */
	from?: string;
}

const EMAIL_FIELDS = ['provider', 'region', 'from'] as const;

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkSesEmailConfig(
	stage: string,
	config: ProviderConfig,
): SesEmailConfig {
	const entry = config as unknown as Record<string, unknown>;
	for (const field of Object.keys(entry)) {
		if (!(EMAIL_FIELDS as readonly string[]).includes(field)) {
			throw new SesProviderConfigInvalid(
				'email',
				stage,
				field,
				entry[field],
				`the ses provider takes ${EMAIL_FIELDS.slice(1).join(', ')} only`,
			);
		}
	}
	if (
		entry.region !== undefined &&
		(typeof entry.region !== 'string' || !REGION.test(entry.region))
	) {
		throw new SesProviderConfigInvalid(
			'email',
			stage,
			'region',
			entry.region,
			"set it to an AWS region code, like 'eu-west-1'",
		);
	}
	if (
		entry.from !== undefined &&
		(typeof entry.from !== 'string' || !ADDRESS.test(entry.from))
	) {
		throw new SesProviderConfigInvalid(
			'email',
			stage,
			'from',
			entry.from,
			"set it to the address mail is sent from, like 'noreply@example.com'",
		);
	}
	return entry as unknown as SesEmailConfig;
}

/**
 * The IAM user a mail construct sends as on a stage:
 * `gkm-<project>-<stage>-<id>`, at most 64 characters — what the provider
 * creates and the deploy role is scoped to.
 */
export function emailUserName(scope: string, stage: string, id: string) {
	return iamUserName({ scope, stage, id });
}

/**
 * What an inbox's bucket and its IAM user are named for, after the stage:
 * `requests-mail`.
 */
export function inboxBucketId(inbox: string): string {
	return `${appKey(inbox)}-mail`;
}

/** The SNS topic SES announces an inbox's mail on. */
export function inboxTopicName(
	scope: string,
	stage: string,
	inbox: string,
): string {
	return `gkm-${scope}-${stage}-${inboxBucketId(inbox)}`
		.replace(/[^A-Za-z0-9_-]/g, '-')
		.slice(0, 256);
}

/** The stage's AWS account, as every AWS provider asks for it. */
export const SES_PROVISIONING = S3_PROVISIONING;
