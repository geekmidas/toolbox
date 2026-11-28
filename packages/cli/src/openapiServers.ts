import { hostLabels } from '@geekmidas/manifest';
import type { DomainsConfig } from './workspace/types.js';

/** One entry of an OpenAPI document's `servers`. */
export interface OpenApiServer {
	url: string;
	description?: string;
}

/**
 * Where a surface is reached on each deployed stage — `https://` its label
 * under the stage's domain from `domains`, described by the stage's name, in
 * the order the stages are listed. What its OpenAPI document lists as
 * `servers` when the surface names none of its own.
 *
 * @example
 * ```ts
 * surfaceServers({ id: 'Api' }, { staging: 'staging.myapp.com', production: 'myapp.com' });
 * // [{ url: 'https://api.staging.myapp.com', description: 'staging' },
 * //  { url: 'https://api.myapp.com', description: 'production' }]
 * ```
 */
export function surfaceServers(
	surface: { id: string; subdomain?: string },
	domains: DomainsConfig | undefined,
): OpenApiServer[] {
	const label = hostLabels(surface).primary;
	return Object.entries(domains ?? {})
		.filter(([, domain]) => Boolean(domain))
		.map(([stage, domain]) => ({
			url: `https://${label}.${domain}`,
			description: stage,
		}));
}
