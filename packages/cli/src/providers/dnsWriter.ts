/**
 * The DNS records a provider asks for — a certificate's validation record, a
 * CDN's name, a domain's MX — written through the stage's own DNS providers.
 *
 * The same machinery the deploy's DNS step uses for the stack's hosts
 * (`settleStackDns`), handed a plan of CNAMEs and MX records instead of the
 * server's addresses — an MX's value in its zone-file form,
 * `<priority> <host>`, which every DNS provider reads and writes: a record holding its value is left alone, one with another value
 * is replaced and printed, and what is written is read back. A host under no
 * domain in `dns`, or under a `manual` one, is printed for the person to
 * create and reported back, so the provider can say what it is waiting on.
 */

import { type DnsProvider, mxValue } from '@geekmidas/edge/dns';
import {
	type DnsChange,
	type DomainDnsPlan,
	dnsCredentials,
	type PlannedDnsRecord,
	recordTtl,
	settleStackDns,
} from '../compose/dns.js';
import type { CredentialProvider } from '../deploy/credentials.js';
import {
	extractSubdomain,
	findRootDomain,
	normalizeDnsConfig,
} from '../dns/index';
import type {
	DnsProvider as DnsProviderConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';
import type { ProviderDnsRecord, ProviderDnsResult } from './types.js';

export interface ProviderDnsOptions {
	workspace: Pick<NormalizedWorkspace, 'dns'>;
	stage: string;
	dryRun: boolean;
	/** Where the DNS providers' tokens come from. */
	credentials: CredentialProvider;
	/** The provider for a domain — `createDnsProvider` by default. */
	providerFor?: (config: DnsProviderConfig) => Promise<DnsProvider | null>;
	log: (line: string) => void;
}

/** What the writer did, for the stage's state: each change, and its domain's provider. */
export interface ProviderDnsWritten extends ProviderDnsResult {
	changes: DnsChange[];
	providers: Record<string, string>;
}

export async function writeProviderDns(
	records: readonly ProviderDnsRecord[],
	options: ProviderDnsOptions,
): Promise<ProviderDnsWritten> {
	const { log } = options;
	const dns = options.workspace.dns
		? normalizeDnsConfig(options.workspace.dns)
		: {};
	const manual: string[] = [];
	const domains = new Map<string, DomainDnsPlan>();

	for (const record of records) {
		const host = record.host.toLowerCase().replace(/\.$/, '');
		const target = record.value.replace(/\.$/, '');
		const value =
			record.type === 'MX' ? mxValue(record.priority, target) : target;
		const domain = findRootDomain(host, dns);
		if (!domain) {
			log(`   create at its DNS host: ${host} ${record.type} ${value}`);
			manual.push(host);
			continue;
		}
		const config = dns[domain]!;
		const plan = domains.get(domain) ?? {
			domain,
			provider:
				typeof config.provider === 'string' ? config.provider : 'custom',
			config,
			records: [],
		};
		const planned: PlannedDnsRecord = {
			host,
			domain,
			name: extractSubdomain(host, domain),
			type: record.type,
			value,
			ttl: recordTtl(config),
		};
		plan.records.push(planned);
		domains.set(domain, plan);
	}
	if (domains.size === 0) return { manual, changes: [], providers: {} };

	const plans = [...domains.values()];
	const tokens = await dnsCredentials(
		options.stage,
		plans.map(({ domain, config }) => ({ domain, config })),
		options.credentials,
	);
	const applied = await settleStackDns(
		{
			stage: options.stage,
			// No address: these records are CNAMEs and MX, never the server's.
			server: { ipv4: '' },
			domains: plans,
			uncovered: [],
		},
		{
			...(options.dryRun ? { dryRun: true } : { confirm: true }),
			log,
			credentials: {
				...(tokens.godaddy ? { credential: tokens.godaddy } : {}),
				log,
			},
			...(tokens.hostinger ? { hostinger: tokens.hostinger } : {}),
			...(options.providerFor ? { providerFor: options.providerFor } : {}),
		},
	);

	// A `manual` domain's records were printed, not written.
	for (const change of applied.changes) {
		if (change.action !== 'manual') continue;
		const host = plans
			.find((p) => p.domain === change.domain)
			?.records.find((r) => r.name === change.name)?.host;
		if (host) manual.push(host);
	}
	return {
		manual: [...new Set(manual)].sort(),
		changes: applied.changes,
		providers: Object.fromEntries(plans.map((p) => [p.domain, p.provider])),
	};
}
