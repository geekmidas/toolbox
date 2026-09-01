import { describe, expect, it } from 'vitest';
import {
	NoSmtpEndpoint,
	SMTP_REGIONS,
	sesSmtpUrl,
	smtpEndpoint,
	smtpPassword,
} from '../aws/ses';

/**
 * AWS documents the recipe and publishes no worked example, so there is no
 * golden value to assert against. These check the properties the recipe implies
 * instead — which is weaker, and worth being explicit about rather than
 * inventing an expected string.
 */

const KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

describe('smtpPassword', () => {
	it('carries the version byte SES looks for', () => {
		// Without it the password is the right bytes and still rejected.
		const decoded = Buffer.from(smtpPassword(KEY, 'us-east-1'), 'base64');

		expect(decoded[0]).toBe(0x04);
	});

	it('is a version byte and one SHA-256 digest, and nothing else', () => {
		expect(Buffer.from(smtpPassword(KEY, 'us-east-1'), 'base64')).toHaveLength(
			33,
		);
	});

	it('is deterministic, because it is a signature and not a secret', () => {
		// A password that changed per call would rotate itself out from under
		// every deploy.
		expect(smtpPassword(KEY, 'us-east-1')).toBe(smtpPassword(KEY, 'us-east-1'));
	});

	it('differs per region, which is why credentials are not portable', () => {
		expect(smtpPassword(KEY, 'us-east-1')).not.toBe(
			smtpPassword(KEY, 'eu-west-1'),
		);
	});

	it('differs per key', () => {
		expect(smtpPassword(KEY, 'us-east-1')).not.toBe(
			smtpPassword(`${KEY}x`, 'us-east-1'),
		);
	});

	it('refuses a region with no SMTP endpoint', () => {
		// The set is smaller than the set of regions SES runs in, so this is a
		// real mistake to make — and it would surface at the first send.
		expect(() => smtpPassword(KEY, 'af-south-1')).toThrow(NoSmtpEndpoint);
		expect(SMTP_REGIONS).not.toContain('af-south-1');
	});
});

describe('sesSmtpUrl', () => {
	it('is an smtp:// URL like every other backend’s', () => {
		// The whole reason the declaration promises `smtp://` and names no
		// provider: what changes is a host and a credential, not the client.
		const url = sesSmtpUrl({
			accessKeyId: 'AKIAEXAMPLE',
			secretAccessKey: KEY,
			region: 'eu-west-1',
		});

		expect(url.startsWith('smtp://AKIAEXAMPLE:')).toBe(true);
		expect(url.endsWith('@email-smtp.eu-west-1.amazonaws.com:587')).toBe(true);
	});

	it('encodes the password, which is base64 and may contain + and /', () => {
		// Both mean something else in a URL's authority section.
		const url = sesSmtpUrl({
			accessKeyId: 'AKIAEXAMPLE',
			secretAccessKey: KEY,
			region: 'eu-west-1',
		});

		// Round-tripped through the URL parser, which is the consumer that has
		// to get the password back out intact.
		expect(decodeURIComponent(new URL(url).password)).toBe(
			smtpPassword(KEY, 'eu-west-1'),
		);
	});

	it('derives the endpoint rather than taking one', () => {
		expect(smtpEndpoint('ap-southeast-2')).toBe(
			'email-smtp.ap-southeast-2.amazonaws.com',
		);
	});
});
