/**
 * `deploy.cdn.<stage>` checked — pure, and kept apart from the CDN step so
 * the workspace schema refuses a config with the same rule and the same
 * named error the stack does. See `cdn.ts` for what a CDN does.
 */

import { GkmError } from '../errors';

/** The CDNs `deploy.cdn` can name. */
export const CDN_PROVIDERS = ['cloudflare'] as const;

export type CdnProvider = (typeof CDN_PROVIDERS)[number];

/**
 * Where the server's certificate for the hosts the CDN answers comes from —
 * what the CDN checks when it connects to the server:
 *
 * - `'origin'` (the default): one the CDN issues for its origin — Cloudflare's
 *   Origin CA, through the deploy's token — valid 15 years and trusted by
 *   the CDN alone. Kept in the stage's secrets; the server holds no token.
 * - `'dns'`: Let's Encrypt, over the DNS challenge, which the shared Traefik
 *   edge answers through the CDN's DNS with `CF_DNS_API_TOKEN`.
 */
export const CDN_CERTIFICATES = ['origin', 'dns'] as const;

export type CdnCertificate = (typeof CDN_CERTIFICATES)[number];

/**
 * One deployed stage's CDN — `deploy.cdn.<stage>`. `false`, or a stage the
 * map leaves out, serves every host straight from the server.
 */
export type StageCdnConfig =
	| { provider: CdnProvider; certificate?: CdnCertificate }
	| false;

/** A `deploy.cdn` entry that is no CDN gkm knows. */
export class CdnConfigInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly value: unknown,
	) {
		super(
			`deploy.cdn.${stage} is ${JSON.stringify(value)}. Name a CDN — ` +
				`{ provider: ${CDN_PROVIDERS.map((p) => `'${p}'`).join(' | ')}, ` +
				`certificate?: ${CDN_CERTIFICATES.map((c) => `'${c}'`).join(' | ')} } — ` +
				'or false to serve the stage straight from its server.',
		);
		this.name = 'CdnConfigInvalid';
	}
}

/**
 * One `deploy.cdn` entry checked.
 *
 * @throws {CdnConfigInvalid} for anything but a known provider or `false`
 */
export function checkStageCdn(stage: string, value: unknown): StageCdnConfig {
	if (value === false) return false;
	if (
		value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).every((k) => k === 'provider' || k === 'certificate') &&
		(CDN_PROVIDERS as readonly unknown[]).includes(
			(value as { provider?: unknown }).provider,
		) &&
		[undefined, ...CDN_CERTIFICATES].includes(
			(value as { certificate?: never }).certificate,
		)
	) {
		return value as StageCdnConfig;
	}
	throw new CdnConfigInvalid(stage, value);
}
