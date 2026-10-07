import { describe, expect, it } from 'vitest';
import {
	MalformedStorageUrl,
	redactStorageUrl,
	UnexpectedStorageScheme,
	UnregisteredStorageScheme,
} from '../errors';
import { createStorageClient, registerStorageDriver } from '../registry';
import { s3Driver } from '../s3Driver';
import { parse } from '../s3Url';

const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCY';
const ENCODED = encodeURIComponent(SECRET);

/** Everything an error shows when it is logged or printed. */
function shown(error: unknown): string {
	const e = error as Error & { url: string };
	return [e.url, e.message, String(e), e.stack ?? '', JSON.stringify(e)].join(
		'\n',
	);
}

/** What `fn` threw, or `undefined` — which every caller's `toBeInstanceOf` fails on. */
function thrown(fn: () => unknown): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return undefined;
}

describe('credentials in storage URLs never reach an error', () => {
	it('redacts the userinfo of a URL for another provider', () => {
		const error = thrown(() => parse(`https://AKIAEXAMPLE:${ENCODED}@uploads`));
		expect(error).toBeInstanceOf(UnexpectedStorageScheme);
		expect((error as UnexpectedStorageScheme).url).toBe(
			'https://REDACTED@uploads/',
		);
		expect(shown(error)).not.toContain(ENCODED);
		expect(shown(error)).not.toContain('AKIAEXAMPLE');
	});

	it('redacts a malformed URL whose secret was not encoded', () => {
		// An unencoded `/` is how a secret most often breaks a URL — and that
		// string, secret and all, is what the error would otherwise carry.
		const raw = `s3://AKIAEXAMPLE:${SECRET}@uploads`;
		const error = thrown(() => parse(raw));
		expect(error).toBeInstanceOf(MalformedStorageUrl);
		expect((error as MalformedStorageUrl).url).toBe('s3://REDACTED@uploads');
		expect(shown(error)).not.toContain('K7MDENG');
	});

	it('redacts the URL of an unregistered scheme', () => {
		registerStorageDriver(s3Driver);
		const error = thrown(() =>
			createStorageClient(`gs://AKIAEXAMPLE:${ENCODED}@uploads`),
		);
		expect(error).toBeInstanceOf(UnregisteredStorageScheme);
		expect(shown(error)).not.toContain(ENCODED);
	});

	it('leaves a URL without userinfo as it was', () => {
		expect(redactStorageUrl('s3://uploads?region=eu-west-1')).toBe(
			's3://uploads?region=eu-west-1',
		);
		expect(redactStorageUrl('not a url')).toBe('not a url');
	});
});
