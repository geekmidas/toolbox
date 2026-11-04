/**
 * SES's SMTP interface: where it is, and the password an IAM access key signs
 * in with there.
 *
 * SES issues IAM credentials, not SMTP ones. The SMTP password is derived
 * from the key's secret and the region, by SigV4's key derivation over a
 * fixed date and the message `SendRawEmail` — the algorithm the SES
 * Developer Guide gives ("Obtaining Amazon SES SMTP credentials"). A
 * password works in that region only.
 */

import { createHmac } from 'node:crypto';
import type { KeySecret } from '../iam.js';

/** The SMTP endpoint of `region`. */
export function smtpHost(region: string): string {
	return `email-smtp.${region}.amazonaws.com`;
}

/** The port the URL names: STARTTLS on 587. */
export const SMTP_PORT = 587;

/** The SMTP password for an access key's secret, in `region`. */
export function smtpPassword(secretAccessKey: string, region: string): string {
	const sign = (key: Buffer | string, message: string) =>
		createHmac('sha256', key).update(message, 'utf8').digest();
	let signature = sign(`AWS4${secretAccessKey}`, '11111111');
	for (const part of [region, 'ses', 'aws4_request', 'SendRawEmail']) {
		signature = sign(signature, part);
	}
	return Buffer.concat([Buffer.from([0x04]), signature]).toString('base64');
}

/** `smtp://<key id>:<smtp password>@email-smtp.<region>.amazonaws.com:587`. */
export function smtpUrl(
	accessKeyId: string,
	secretAccessKey: string,
	region: string,
): string {
	return (
		`smtp://${encodeURIComponent(accessKeyId)}:` +
		`${encodeURIComponent(smtpPassword(secretAccessKey, region))}` +
		`@${smtpHost(region)}:${SMTP_PORT}`
	);
}

/** The user an `smtp://` URL signs in as, whatever its host. */
export function smtpUser(value: string): string | undefined {
	try {
		const url = new URL(value);
		return url.username ? decodeURIComponent(url.username) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * A mail construct's URL as a key's secret. A URL on another region's
 * endpoint holds no key this region can use — its password was derived for
 * that region — so it counts as holding none, and a new key is issued.
 */
export function smtpKeySecret(urlKey: string, region: string): KeySecret {
	return {
		key: urlKey,
		keyIdOf(value) {
			try {
				return new URL(value).hostname === smtpHost(region)
					? smtpUser(value)
					: undefined;
			} catch {
				return undefined;
			}
		},
		value: (accessKeyId, secretAccessKey) =>
			smtpUrl(accessKeyId, secretAccessKey, region),
	};
}
