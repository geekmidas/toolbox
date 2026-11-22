/**
 * `deploy.cdn` — a CDN in front of a compose stage's sites (#541).
 *
 * Every request to a site otherwise goes to the stage's one server, and a
 * visitor far from it pays a TCP and a TLS handshake across that distance
 * before the first byte. A CDN ends both at an edge near the visitor, keeps
 * a warm connection to the server, and serves the content-hashed assets
 * from its cache.
 *
 * - **`{ provider: 'cloudflare' }`**: Cloudflare's proxy. The stage's domain
 *   is on Cloudflare DNS (`dns: { '<domain>': { provider: 'cloudflare' } }`),
 *   and every host a site answers on — its own, its aliases, its redirects,
 *   a wildcard site's `*.<domain>` — is written proxied. Every other host
 *   (an API, the auth server, the telemetry UI) stays a plain record to the
 *   server. The server still holds a certificate for each site host, so
 *   Cloudflare reaches it over HTTPS with the zone on Full (strict). A host
 *   Cloudflare answers does not reliably pass Let's Encrypt's HTTP challenge
 *   on to the server, so that certificate is, by `certificate`:
 *   - `'origin'` (the default): an origin certificate the deploy has
 *     Cloudflare's Origin CA issue for exactly those hosts — 15 years, kept
 *     in the stage's secrets, served for them alone by either proxy
 *     (`originCertificate.ts`);
 *   - `'dns'`: Let's Encrypt over the DNS challenge, which the shared Traefik
 *     edge answers through Cloudflare (`CF_DNS_API_TOKEN` in the stage's
 *     secrets).
 *   A stage with its own certificate (`deploy.compose.tls`) needs neither.
 *
 * Pure.
 */

import { findRootDomain, normalizeDnsConfig } from '../dns/index';
import { GkmError } from '../errors';
import type { NormalizedWorkspace } from '../workspace/types';
import {
	type CdnCertificate,
	type CdnProvider,
	checkStageCdn,
} from './cdnConfig';

export {
	CDN_CERTIFICATES,
	CDN_PROVIDERS,
	type CdnCertificate,
	CdnConfigInvalid,
	type CdnProvider,
	checkStageCdn,
	type StageCdnConfig,
} from './cdnConfig';

/** A stage's CDN, resolved against its domain. */
export interface StageCdn {
	provider: CdnProvider;
	/** Where the server's certificate for its hosts comes from. */
	certificate: CdnCertificate;
	/** The stage's domain: `example.com`. */
	domain: string;
	/** The root domain in `dns` that holds it. */
	zone: string;
}

/** A CDN answers the stage's hosts, and the stage has none. */
export class CdnNeedsDomain extends GkmError {
	constructor(readonly stage: string) {
		super(
			`deploy.cdn.${stage} puts a CDN in front of '${stage}''s sites, which ` +
				`answers on their hosts under the stage's domain — and '${stage}' has ` +
				`none. Set domains.${stage} in gkm.config.ts, or drop deploy.cdn.${stage}.`,
		);
		this.name = 'CdnNeedsDomain';
	}
}

/** Cloudflare can only proxy a name whose DNS it serves. */
export class CdnNeedsCloudflareDns extends GkmError {
	constructor(
		readonly stage: string,
		readonly domain: string,
		/** The provider `dns` gives the domain, if any. */
		readonly provider: string | undefined,
	) {
		super(
			`deploy.cdn.${stage} is Cloudflare, which proxies only names whose DNS ` +
				`it serves, and ${domain}'s is ${provider ? `${provider}'s` : 'in no `dns` entry'}. ` +
				`Add ${domain} to Cloudflare, point its nameservers there (the ` +
				`registration can stay where it is), and set ` +
				`dns: { '${domain}': { provider: 'cloudflare' } } in gkm.config.ts.`,
		);
		this.name = 'CdnNeedsCloudflareDns';
	}
}

/**
 * `certificate: 'dns'` on the stack's own Caddy, which answers no DNS
 * challenge.
 */
export class CdnCertificateUnavailable extends GkmError {
	constructor(readonly stage: string) {
		super(
			`deploy.cdn.${stage} gets its certificates over the DNS challenge ` +
				"(certificate: 'dns'), which the stack's own Caddy does not answer. " +
				'Drop `certificate` for an origin certificate from the CDN, which ' +
				'either proxy serves, or serve the stage from the shared Traefik ' +
				`edge (deploy.compose.proxy: { ${stage}: 'traefik' }).`,
		);
		this.name = 'CdnCertificateUnavailable';
	}
}

/**
 * The CDN in front of `stage`, or `undefined` where it has none. The local
 * stage never has one.
 *
 * @throws {CdnNeedsDomain} for a CDN on a stage with no domain
 * @throws {CdnNeedsCloudflareDns} for Cloudflare on a domain it does not serve
 */
export function stageCdn(
	workspace: Pick<NormalizedWorkspace, 'domains' | 'dns' | 'deploy'>,
	stage: string,
): StageCdn | undefined {
	const cdn: Readonly<Record<string, unknown>> | undefined =
		workspace.deploy?.cdn;
	const entry = cdn?.[stage];
	if (entry === undefined) return undefined;
	const config = checkStageCdn(stage, entry);
	if (!config) return undefined;

	const domain = workspace.domains?.[stage]?.toLowerCase();
	if (!domain) throw new CdnNeedsDomain(stage);
	const dns = workspace.dns ? normalizeDnsConfig(workspace.dns) : {};
	const zone = findRootDomain(domain, dns);
	const provider = zone ? dns[zone]?.provider : undefined;
	if (!zone || provider !== 'cloudflare') {
		throw new CdnNeedsCloudflareDns(
			stage,
			domain,
			typeof provider === 'string' ? provider : undefined,
		);
	}
	return {
		provider: config.provider,
		certificate: config.certificate ?? 'origin',
		domain,
		zone,
	};
}
