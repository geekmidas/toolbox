import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MissingCredential } from '../../deploy/credentials';
import {
	ensureOriginCertificate,
	ORIGIN_CERT_KEY,
	ORIGIN_KEY_KEY,
	ORIGIN_VALIDITY_DAYS,
	originCertificateProblem,
} from '../originCertificate';
import { originCa } from './__helpers__/originCa';

/**
 * The CDN's origin certificate, against an Origin CA stand-in that signs
 * whatever request it is sent — so what is kept and checked is a real
 * certificate for a real key.
 */

const HOSTS = ['shop.example.com', 'www.shop.example.com'];

const token = { get: async () => ({ token: 'cf-token' }) as never };

/** A run of it, keeping what it keeps. */
async function ensure(
	options: {
		hosts?: string[];
		custom?: Record<string, string>;
		dryRun?: boolean;
		now?: Date;
		ca?: ReturnType<typeof originCa>;
		credentials?: { get: () => Promise<never> };
	} = {},
) {
	const authority = options.ca ?? originCa();
	const kept: Record<string, string>[] = [];
	const lines: string[] = [];
	const result = await ensureOriginCertificate({
		stage: 'production',
		zone: 'example.com',
		hosts: options.hosts ?? HOSTS,
		custom: options.custom,
		credentials: options.credentials ?? token,
		keep: async (values) => {
			kept.push(values);
		},
		...(options.dryRun ? { dryRun: true } : {}),
		...(options.now ? { now: options.now } : {}),
		log: (line) => lines.push(line),
		issuer: authority.issuer,
	});
	return { result, kept, lines, ...authority };
}

describe('ensureOriginCertificate', () => {
	it('has one issued for exactly the hosts, for 15 years, and keeps it', async () => {
		const { result, kept, asked } = await ensure({
			hosts: ['WWW.shop.example.com', 'shop.example.com'],
		});

		expect(asked).toEqual([
			{ zone: 'example.com', hostnames: HOSTS, days: ORIGIN_VALIDITY_DAYS },
		]);
		expect(kept).toEqual([
			{ [ORIGIN_CERT_KEY]: result!.cert, [ORIGIN_KEY_KEY]: result!.key },
		]);
		const cert = new X509Certificate(result!.cert);
		expect(cert.subjectAltName).toBe(
			'DNS:shop.example.com, DNS:www.shop.example.com',
		);
		expect(originCertificateProblem(result, HOSTS)).toBeUndefined();
	});

	it('sends a signing request, never the key', async () => {
		const { result, csrs } = await ensure();

		expect(csrs[0]).toContain('BEGIN CERTIFICATE REQUEST');
		expect(csrs[0]).not.toContain('PRIVATE KEY');
		expect(result!.key).toContain('BEGIN PRIVATE KEY');
	});

	it('reuses the one kept while it serves the hosts', async () => {
		const first = await ensure();
		const custom = first.kept[0]!;

		const again = await ensure({ custom });

		expect(again.asked).toEqual([]);
		expect(again.kept).toEqual([]);
		expect(again.result).toEqual(first.result);
	});

	it.each([
		['the hosts changed', { hosts: [...HOSTS, 'docs.shop.example.com'] }],
		[
			'it is about to expire',
			{ now: new Date(Date.now() + (ORIGIN_VALIDITY_DAYS - 10) * 86_400_000) },
		],
	])('has another issued when %s', async (_, options) => {
		const first = await ensure();

		const again = await ensure({ custom: first.kept[0], ...options });

		expect(again.asked).toHaveLength(1);
		expect(again.kept).toHaveLength(1);
	});

	it('has another issued when the key kept is not its own', async () => {
		const a = await ensure();
		const b = await ensure();

		const again = await ensure({
			custom: {
				[ORIGIN_CERT_KEY]: a.result!.cert,
				[ORIGIN_KEY_KEY]: b.result!.key,
			},
		});

		expect(again.asked).toHaveLength(1);
	});

	it('issues nothing on a dry run, and says it would', async () => {
		const { result, asked, kept, lines } = await ensure({ dryRun: true });

		expect(result).toBeUndefined();
		expect(asked).toEqual([]);
		expect(kept).toEqual([]);
		expect(lines.join('\n')).toContain(
			'would have Cloudflare issue an origin certificate',
		);
	});

	it('needs the deploy’s Cloudflare token to issue one', async () => {
		await expect(
			ensure({ credentials: { get: async () => undefined as never } }),
		).rejects.toBeInstanceOf(MissingCredential);
	});
});
