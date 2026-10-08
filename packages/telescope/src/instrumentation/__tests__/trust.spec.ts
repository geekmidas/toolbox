import { describe, expect, it } from 'vitest';
import { traceSamplerFromEnv } from '../sampler';
import { isInternalCaller, isPrivateAddress, isTrustedOrigin } from '../trust';

describe('isTrustedOrigin', () => {
	const origins = ['https://web.example.com', 'http://localhost:5173'];

	it('trusts exactly the listed origins', () => {
		expect(isTrustedOrigin('https://web.example.com', origins)).toBe(true);
		expect(isTrustedOrigin('http://localhost:5173', origins)).toBe(true);
	});

	it('trusts no other scheme, host or port', () => {
		expect(isTrustedOrigin('http://web.example.com', origins)).toBe(false);
		expect(isTrustedOrigin('https://web.example.com.evil.net', origins)).toBe(
			false,
		);
		expect(isTrustedOrigin('http://localhost:5174', origins)).toBe(false);
	});

	it('trusts nothing for a wildcard, an opaque origin or no list', () => {
		expect(isTrustedOrigin('https://web.example.com', ['*'])).toBe(false);
		expect(isTrustedOrigin('null', ['null'])).toBe(false);
		expect(isTrustedOrigin('https://web.example.com', undefined)).toBe(false);
		expect(isTrustedOrigin(undefined, origins)).toBe(false);
	});
});

describe('isPrivateAddress', () => {
	it.each([
		'127.0.0.1',
		'10.0.3.7',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.1.20',
		'169.254.0.5',
		'::1',
		'::ffff:172.18.0.4',
		'fd12:3456::1',
		'fe80::1',
	])('%s is private', (address) => {
		expect(isPrivateAddress(address)).toBe(true);
	});

	it.each([
		'203.0.113.7',
		'172.32.0.1',
		'8.8.8.8',
		'2001:db8::1',
		'::ffff:8.8.8.8',
		'',
		undefined,
	])('%s is not', (address) => {
		expect(isPrivateAddress(address)).toBe(false);
	});
});

describe('isInternalCaller', () => {
	it('is a private peer with no Origin and no proxy header', () => {
		expect(isInternalCaller({ headers: {}, remoteAddress: '172.18.0.4' })).toBe(
			true,
		);
	});

	it('is not a browser, which always sends Origin cross-site', () => {
		expect(
			isInternalCaller({
				headers: { Origin: 'https://web.example.com' },
				remoteAddress: '172.18.0.4',
			}),
		).toBe(false);
	});

	it.each([
		'x-forwarded-for',
		'forwarded',
		'x-real-ip',
		'cf-connecting-ip',
	])('is not a request a proxy forwarded (%s)', (name) => {
		expect(
			isInternalCaller({
				headers: new Headers({ [name]: '203.0.113.7' }),
				remoteAddress: '172.18.0.2',
			}),
		).toBe(false);
	});

	it('is not a public peer, or one the server cannot see', () => {
		expect(
			isInternalCaller({ headers: {}, remoteAddress: '203.0.113.7' }),
		).toBe(false);
		expect(isInternalCaller({ headers: {} })).toBe(false);
	});
});

describe('traceSamplerFromEnv', () => {
	it("is the capped sampler at the stage's rate", () => {
		expect(
			traceSamplerFromEnv({
				OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
				OTEL_TRACES_SAMPLER_ARG: '0.1',
			})?.toString(),
		).toBe(
			'ParentBased{root=TraceIdRatioBased{0.1}, remoteParentSampled=TraceIdRatioBased{0.1}, remoteParentNotSampled=AlwaysOffSampler, localParentSampled=AlwaysOnSampler, localParentNotSampled=AlwaysOffSampler}',
		);
	});

	it('leaves any other sampler, and a bad rate, to the SDK', () => {
		expect(traceSamplerFromEnv({})).toBeUndefined();
		expect(
			traceSamplerFromEnv({ OTEL_TRACES_SAMPLER: 'always_on' }),
		).toBeUndefined();
		expect(
			traceSamplerFromEnv({
				OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
				OTEL_TRACES_SAMPLER_ARG: 'lots',
			}),
		).toBeUndefined();
	});
});
