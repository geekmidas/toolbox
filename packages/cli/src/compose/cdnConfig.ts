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
 * One deployed stage's CDN — `deploy.cdn.<stage>`. `false`, or a stage the
 * map leaves out, serves every host straight from the server.
 */
export type StageCdnConfig = { provider: CdnProvider } | false;

/** A `deploy.cdn` entry that is no CDN gkm knows. */
export class CdnConfigInvalid extends GkmError {
	constructor(
		readonly stage: string,
		readonly value: unknown,
	) {
		super(
			`deploy.cdn.${stage} is ${JSON.stringify(value)}. Name a CDN — ` +
				`{ provider: ${CDN_PROVIDERS.map((p) => `'${p}'`).join(' | ')} } — or ` +
				'false to serve the stage straight from its server.',
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
		Object.keys(value).every((k) => k === 'provider') &&
		(CDN_PROVIDERS as readonly unknown[]).includes(
			(value as { provider?: unknown }).provider,
		)
	) {
		return value as StageCdnConfig;
	}
	throw new CdnConfigInvalid(stage, value);
}
