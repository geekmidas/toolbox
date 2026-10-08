/**
 * A compose stage's DNS: the records its public hosts need, and the check that
 * they resolve to its server before a certificate is asked for.
 *
 * - **The server** (`serverAddress`): the stage's own secrets hold its public
 *   addresses — `GKM_SERVER_IPV4`, and `GKM_SERVER_IPV6` where it has one.
 *   Reserved for gkm: never handed to an app.
 * - **The plan** (`planStackDns`, pure): every public host the stack serves —
 *   its apex, each app, each file server, the public log UI — pointed at the
 *   server. An A record per host (and an AAAA with an IPv6 address), or, where
 *   the domain's `dns` entry says `records: { mode: 'cname', target }`, one A
 *   record for the target and a CNAME to it for every other host but the
 *   apex, which DNS forbids a CNAME at.
 * - **Applying it** (`applyStackDns`): through the domain's provider in `dns`,
 *   a record set at a time. A record with the right value is left alone; one
 *   with another value is replaced and the change printed. A `manual` domain
 *   is printed and nothing else. A dry run reads, prints and writes nothing.
 * - **The check** (`checkStackDns`): each host resolved with the system
 *   resolver. One that is not the server stops the deploy with
 *   {@link HostNotPointingAtServer}, before Caddy or Traefik ask Let's Encrypt
 *   for a certificate it cannot get — and use up the rate limit trying.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import {
	createDnsProvider,
	type DnsProvider,
	type DnsRecord,
	DnsRecordsUnreadable,
	type DnsConfig as SchemaDnsConfig,
} from '../target/dokploy/dns/DnsProvider';
import type { GoDaddyProviderOptions } from '../target/dokploy/dns/GoDaddyProvider';
import {
	extractSubdomain,
	findRootDomain,
	normalizeDnsConfig,
} from '../target/dokploy/dns/index';
import type {
	DnsProvider as DnsProviderConfig,
	WorkspaceDnsConfig,
} from '../workspace/types';
import {
	cnameTarget,
	type DnsRecordsMode,
	isReservedStageKey,
	SERVER_IPV4_KEY,
	SERVER_IPV6_KEY,
} from './dnsConfig';

export { isReservedStageKey, SERVER_IPV4_KEY, SERVER_IPV6_KEY };

import type { ComposeStack } from './stack';

/** A deployed stage's server: what its hosts' records point at. */
export interface ServerAddress {
	ipv4: string;
	ipv6?: string;
}

/** The line that says how to set the server's address. */
export function serverAddressHint(stage: string): string {
	return `gkm secrets:set ${SERVER_IPV4_KEY} '<ip>' --stage ${stage}`;
}

/** A server address in the stage's secrets that is not an address. */
export class ServerAddressInvalid extends Error {
	constructor(
		readonly stage: string,
		readonly key: string,
		readonly value: string,
	) {
		const ipv4 = key === SERVER_IPV4_KEY;
		super(
			`${key} in the '${stage}' stage's secrets is ${JSON.stringify(value)}, ` +
				`which is not an ${ipv4 ? 'IPv4 address (like 203.0.113.10)' : 'IPv6 address (like 2001:db8::10)'}. ` +
				`Set the server's public address: gkm secrets:set ${key} '<ip>' --stage ${stage}.`,
		);
		this.name = 'ServerAddressInvalid';
	}
}

/**
 * A compose stage that serves real domains with no server address: its hosts
 * cannot be pointed or checked, and a certificate would be asked for blind.
 */
export class ServerAddressMissing extends Error {
	constructor(
		readonly stage: string,
		readonly domain: string,
	) {
		super(
			`The '${stage}' stage serves ${domain} and its secrets hold no ` +
				`${SERVER_IPV4_KEY} — the public address of the server its stack runs ` +
				"on, which its hosts' DNS records point at and every deploy checks " +
				`before asking for certificates. Set it: ${serverAddressHint(stage)} ` +
				`(and ${SERVER_IPV6_KEY} for an IPv6 address).`,
		);
		this.name = 'ServerAddressMissing';
	}
}

/**
 * The server's address from the stage's secrets, checked — `undefined` when
 * `GKM_SERVER_IPV4` is not set.
 *
 * @throws {ServerAddressInvalid} for a value that is not an address
 */
export function serverAddress(
	stage: string,
	custom: Readonly<Record<string, string>> | undefined,
): ServerAddress | undefined {
	const ipv4 = custom?.[SERVER_IPV4_KEY]?.trim();
	const ipv6 = custom?.[SERVER_IPV6_KEY]?.trim();
	if (ipv6 && !isIPv6(ipv6)) {
		throw new ServerAddressInvalid(stage, SERVER_IPV6_KEY, ipv6);
	}
	if (!ipv4) return undefined;
	if (!isIPv4(ipv4))
		throw new ServerAddressInvalid(stage, SERVER_IPV4_KEY, ipv4);
	return { ipv4, ...(ipv6 ? { ipv6 } : {}) };
}

/**
 * A name that resolves to this machine by definition — `localhost` and every
 * `*.localhost` — and is in nobody's DNS.
 */
export function isLocalHost(host: string): boolean {
	const name = host.toLowerCase().replace(/\.$/, '');
	return name === 'localhost' || name.endsWith('.localhost');
}

/**
 * The server's address, required where the stage serves real domains — not
 * `*.localhost` ones, which point at this machine already.
 *
 * @throws {ServerAddressMissing} when the stage has a domain and no address
 * @throws {ServerAddressInvalid} for a value that is not an address
 */
export function requiredServerAddress(
	stage: string,
	domain: string | undefined,
	custom: Readonly<Record<string, string>> | undefined,
): ServerAddress | undefined {
	const server = serverAddress(stage, custom);
	if (!server && domain && !isLocalHost(domain)) {
		throw new ServerAddressMissing(stage, domain);
	}
	return server;
}

/** The record types the DNS step writes. */
export type StackRecordType = 'A' | 'AAAA' | 'CNAME';

const MANAGED: readonly StackRecordType[] = ['A', 'AAAA', 'CNAME'];

/** One record a stack's host needs. */
export interface PlannedDnsRecord {
	/** The full name: `api.example.com`. */
	host: string;
	/** The root domain in `dns` it is under. */
	domain: string;
	/** Relative to the domain, as providers take it: `api`, `@`. */
	name: string;
	type: StackRecordType;
	value: string;
	ttl: number;
}

/** One `dns` domain's share of the plan. */
export interface DomainDnsPlan {
	domain: string;
	/** `godaddy`, `route53`, `manual`, … — `custom` for an object. */
	provider: string;
	config: DnsProviderConfig;
	records: PlannedDnsRecord[];
}

export interface StackDnsPlan {
	stage: string;
	server: ServerAddress;
	domains: DomainDnsPlan[];
	/** Hosts under no `dns` domain: theirs to point by hand. */
	uncovered: string[];
}

/** Every public host the stack serves, once each, sorted. */
export function stackHosts(stack: Pick<ComposeStack, 'routes'>): string[] {
	return [...new Set(stack.routes.map((route) => route.host))].sort();
}

/** The TTL a domain's records are written with. */
export function recordTtl(config: DnsProviderConfig): number {
	const ttl = 'ttl' in config ? config.ttl : undefined;
	if (ttl) return ttl;
	return config.provider === 'godaddy' ? 600 : 300;
}

function providerName(config: DnsProviderConfig): string {
	return typeof config.provider === 'string' ? config.provider : 'custom';
}

export interface PlanStackDnsInput {
	stage: string;
	hosts: readonly string[];
	server: ServerAddress;
	dns: WorkspaceDnsConfig | undefined;
}

/** The records a stage's hosts need — pure. */
export function planStackDns(input: PlanStackDnsInput): StackDnsPlan {
	const { stage, server } = input;
	const dns = input.dns ? normalizeDnsConfig(input.dns) : {};
	const records = new Map<string, PlannedDnsRecord>();
	const uncovered: string[] = [];

	const add = (
		host: string,
		domain: string,
		type: StackRecordType,
		value: string,
	) => {
		const name = extractSubdomain(host, domain);
		records.set(`${domain} ${name} ${type}`, {
			host,
			domain,
			name,
			type,
			value,
			ttl: recordTtl(dns[domain]!),
		});
	};
	const pointAt = (host: string, domain: string) => {
		add(host, domain, 'A', server.ipv4);
		if (server.ipv6) add(host, domain, 'AAAA', server.ipv6);
	};

	for (const raw of input.hosts) {
		const host = raw.toLowerCase();
		const domain = findRootDomain(host, dns);
		if (!domain) {
			uncovered.push(host);
			continue;
		}
		// A target under the domain itself — the schema refuses one that is
		// not — gets the A record every other host's CNAME points at.
		const target = cnameTarget(
			(dns[domain] as { records?: DnsRecordsMode }).records,
			stage,
		);
		if (target) pointAt(target, domain);
		// The apex can hold no CNAME — it has the zone's SOA and NS — so it
		// is always an A record.
		if (target && host !== domain && host !== target) {
			add(host, domain, 'CNAME', target);
		} else {
			pointAt(host, domain);
		}
	}

	const domains = new Map<string, DomainDnsPlan>();
	for (const record of [...records.values()].sort(
		(a, b) =>
			a.domain.localeCompare(b.domain) ||
			a.name.localeCompare(b.name) ||
			a.type.localeCompare(b.type),
	)) {
		const config = dns[record.domain]!;
		const plan = domains.get(record.domain) ?? {
			domain: record.domain,
			provider: providerName(config),
			config,
			records: [],
		};
		plan.records.push(record);
		domains.set(record.domain, plan);
	}

	return {
		stage,
		server,
		domains: [...domains.values()],
		uncovered: uncovered.sort(),
	};
}

/** One change applying a plan makes — or, in a dry run, would. */
export interface DnsChange {
	domain: string;
	name: string;
	type: StackRecordType;
	/**
	 * `write`: the provider's key cannot read records, so the record is
	 * written without knowing what is there — idempotent, and not diffed.
	 */
	action: 'create' | 'update' | 'delete' | 'unchanged' | 'write' | 'manual';
	/** The value it is set to — absent for a delete. */
	value?: string;
	/** What it was, for an update or a delete. */
	previous?: string;
	ttl?: number;
}

export interface ApplyStackDnsOptions {
	dryRun?: boolean;
	log?: (line: string) => void;
	/** Where the GoDaddy provider reads its key: the environment and the CLI's home. */
	credentials?: GoDaddyProviderOptions;
	/** The provider for a domain — `createDnsProvider` by default. */
	providerFor?: (config: DnsProviderConfig) => Promise<DnsProvider | null>;
}

/** `api.example.com  A  203.0.113.10  (TTL 600)` */
function describe(record: PlannedDnsRecord): string {
	return `${record.host.padEnd(32)} ${record.type.padEnd(5)} ${record.value}  (TTL ${record.ttl})`;
}

function printManual(
	plan: DomainDnsPlan,
	log: (line: string) => void,
	why: string,
): DnsChange[] {
	log(`   ${plan.domain}: ${why} — create these records at its DNS host:`);
	for (const record of plan.records) log(`     ${describe(record)}`);
	return plan.records.map((r) => ({
		domain: r.domain,
		name: r.name,
		type: r.type,
		action: 'manual',
		value: r.value,
		ttl: r.ttl,
	}));
}

/** The existing records of every planned name, for the types gkm manages. */
async function existingRecords(
	provider: DnsProvider,
	plan: DomainDnsPlan,
): Promise<DnsRecord[]> {
	const names = [...new Set(plan.records.map((r) => r.name))];
	const wanted = names.flatMap((name) =>
		MANAGED.map((type) => ({ name, type })),
	);
	if (provider.readRecords) return provider.readRecords(plan.domain, wanted);
	const all = await provider.getRecords(plan.domain);
	return all.filter(
		(r) =>
			names.includes(r.name) && (MANAGED as readonly string[]).includes(r.type),
	);
}

const same = (a: string, b: string) =>
	a.trim().replace(/\.$/, '').toLowerCase() ===
	b.trim().replace(/\.$/, '').toLowerCase();

/**
 * What each domain's records need, compared with what is there: creates,
 * updates, and the deletes a change of mode needs — a name moving from an A
 * record to a CNAME, or back, cannot hold both. Nothing else is deleted.
 */
export function diffDomainDns(
	plan: DomainDnsPlan,
	existing: readonly DnsRecord[],
): DnsChange[] {
	const changes: DnsChange[] = [];
	const find = (name: string, type: string) =>
		existing.find((r) => r.name === name && r.type === type);

	const planned = new Map<string, Set<StackRecordType>>();
	for (const record of plan.records) {
		const types = planned.get(record.name) ?? new Set();
		types.add(record.type);
		planned.set(record.name, types);
	}

	// The deletes first: a CNAME where an A record goes, A and AAAA where a
	// CNAME goes.
	for (const [name, types] of planned) {
		const conflicting: StackRecordType[] = types.has('CNAME')
			? ['A', 'AAAA']
			: ['CNAME'];
		for (const type of conflicting) {
			const found = find(name, type);
			if (!found || found.values.length === 0) continue;
			changes.push({
				domain: plan.domain,
				name,
				type,
				action: 'delete',
				previous: found.values.join(', '),
			});
		}
	}

	for (const record of plan.records) {
		const found = find(record.name, record.type);
		const base = {
			domain: plan.domain,
			name: record.name,
			type: record.type,
			value: record.value,
			ttl: record.ttl,
		};
		if (!found || found.values.length === 0) {
			changes.push({ ...base, action: 'create' });
		} else if (
			found.values.length === 1 &&
			same(found.values[0]!, record.value)
		) {
			changes.push({ ...base, action: 'unchanged' });
		} else {
			changes.push({
				...base,
				action: 'update',
				previous: found.values.join(', '),
			});
		}
	}
	return changes;
}

/** A host's full name from a domain and a relative name. */
function fullName(domain: string, name: string): string {
	return name === '@' ? domain : `${name}.${domain}`;
}

function printChange(
	change: DnsChange,
	dryRun: boolean,
	log: (line: string) => void,
) {
	const host = fullName(change.domain, change.name).padEnd(32);
	const type = change.type.padEnd(5);
	const would = dryRun ? 'would ' : '';
	switch (change.action) {
		case 'unchanged':
			log(
				`   ✓ ${host} ${type} ${change.value}  (TTL ${change.ttl}) — up to date`,
			);
			break;
		case 'create':
			log(
				`   + ${host} ${type} ${change.value}  (TTL ${change.ttl}) — ${would}create`,
			);
			break;
		case 'update':
			log(
				`   ~ ${host} ${type} ${change.previous} → ${change.value}  (TTL ${change.ttl}) — ${would}update`,
			);
			break;
		case 'write':
			log(
				dryRun
					? `   ? ${host} ${type} ${change.value}  (TTL ${change.ttl}) — would write; current value unknown (key cannot read DNS)`
					: `   ! ${host} ${type} ${change.value}  (TTL ${change.ttl}) — written (not diffed)`,
			);
			break;
		case 'delete':
			log(
				`   - ${host} ${type} ${change.previous} — ${would}delete (a name cannot hold a CNAME and an A record)`,
			);
			break;
	}
}

/**
 * Each domain's records, through its provider. Returns every change, the
 * unchanged included; a dry run makes none of them.
 */
export async function applyStackDns(
	plan: StackDnsPlan,
	options: ApplyStackDnsOptions = {},
): Promise<DnsChange[]> {
	const dryRun = options.dryRun === true;
	const log = options.log ?? ((line: string) => console.log(line));
	const providerFor =
		options.providerFor ??
		((config: DnsProviderConfig) =>
			createDnsProvider({
				config: config as SchemaDnsConfig,
				...(options.credentials ? { godaddy: options.credentials } : {}),
			}));

	const changes: DnsChange[] = [];
	for (const host of plan.uncovered) {
		log(
			`   ⚠ ${host} is under no domain in dns — point it at ${plan.server.ipv4} yourself`,
		);
	}

	for (const domain of plan.domains) {
		if (domain.provider === 'manual') {
			changes.push(...printManual(domain, log, 'manual'));
			continue;
		}
		const provider = await providerFor(domain.config);
		if (!provider) {
			changes.push(...printManual(domain, log, 'manual'));
			continue;
		}

		log(`   ${domain.domain} (${provider.name})${dryRun ? ' — dry run' : ''}`);
		let existing: DnsRecord[];
		let diff: DnsChange[];
		try {
			existing = await existingRecords(provider, domain);
			diff = diffDomainDns(domain, existing);
		} catch (error) {
			if (!(error instanceof DnsRecordsUnreadable)) throw error;
			log(
				`   ℹ The ${provider.name} key cannot read ${domain.domain}'s DNS records, so changes cannot be diffed: every record is written (idempotent).`,
			);
			existing = [];
			diff = domain.records.map((r) => ({
				domain: r.domain,
				name: r.name,
				type: r.type,
				action: 'write' as const,
				value: r.value,
				ttl: r.ttl,
			}));
		}
		for (const change of diff) printChange(change, dryRun, log);

		// An AAAA nobody planned, at a name that points here: IPv6 clients —
		// Let's Encrypt among them — would go somewhere else.
		if (!plan.server.ipv6) {
			for (const name of new Set(domain.records.map((r) => r.name))) {
				const aaaa = existing.find((r) => r.name === name && r.type === 'AAAA');
				const planned = domain.records.find(
					(r) => r.name === name && r.type === 'A',
				);
				if (aaaa && planned && aaaa.values.length > 0) {
					log(
						`   ⚠ ${fullName(domain.domain, name)} also has AAAA ${aaaa.values.join(', ')}: ` +
							`set ${SERVER_IPV6_KEY} in the '${plan.stage}' stage's secrets to the server's IPv6 address, ` +
							'or remove that record, or IPv6 clients go elsewhere',
					);
				}
			}
		}

		changes.push(...diff);
		if (dryRun) continue;

		const deletes = diff.filter((c) => c.action === 'delete');
		if (deletes.length > 0) {
			await provider.deleteRecords(
				domain.domain,
				deletes.map((c) => ({ name: c.name, type: c.type })),
			);
		}
		const writes = diff.filter(
			(c) =>
				c.action === 'create' || c.action === 'update' || c.action === 'write',
		);
		if (writes.length > 0) {
			await provider.upsertRecords(
				domain.domain,
				writes.map((c) => ({
					name: c.name,
					type: c.type,
					value: c.value!,
					ttl: c.ttl!,
				})),
			);
		}
	}
	return changes;
}

// ============================================================================
// The check
// ============================================================================

/** Resolves a host to every address it has — `dns.promises.lookup`, `all`. */
export type HostLookup = (host: string) => Promise<string[]>;

/** The system resolver: what the server's own clients would be told. */
export const systemLookup: HostLookup = async (host) => {
	const found = await dnsLookup(host, { all: true });
	return found.map((a) => a.address);
};

/** One host that does not resolve to the server. */
export interface MisdirectedHost {
	host: string;
	/** What it resolves to — empty when it does not resolve. */
	resolved: string[];
	/** Why it did not resolve, when it did not. */
	error?: string;
}

/** Hosts that do not resolve to the stage's server. */
export class HostNotPointingAtServer extends Error {
	constructor(
		readonly stage: string,
		readonly hosts: readonly MisdirectedHost[],
		readonly expected: { ipv4: string; ipv6?: string },
		/** The records to create, where `dns` covers none of them. */
		readonly fix: string,
	) {
		const want = expected.ipv6
			? `${expected.ipv4} (and ${expected.ipv6})`
			: expected.ipv4;
		const lines = hosts.map(
			(h) =>
				`  - ${h.host} → ${h.resolved.length > 0 ? h.resolved.join(', ') : `nothing${h.error ? ` (${h.error})` : ''}`}, expected ${want}`,
		);
		super(
			`${hosts.length === 1 ? 'A host' : `${hosts.length} hosts`} of '${stage}' ` +
				`do${hosts.length === 1 ? 'es' : ''} not resolve to its server, so a ` +
				`certificate for ${hosts.length === 1 ? 'it' : 'them'} cannot be issued:\n` +
				`${lines.join('\n')}\n${fix}\n` +
				'Records can take a few minutes to propagate. With a CDN or proxy in ' +
				'front of the server, pass --skip-dns-check.',
		);
		this.name = 'HostNotPointingAtServer';
	}
}

export interface CheckStackDnsInput {
	stage: string;
	hosts: readonly string[];
	server: ServerAddress;
	dns: WorkspaceDnsConfig | undefined;
	lookup?: HostLookup;
}

/**
 * Every host resolved: each must resolve to the server's IPv4 address and to
 * nothing but the server's addresses.
 *
 * @throws {HostNotPointingAtServer} naming every host that does not
 */
export async function checkStackDns(
	input: CheckStackDnsInput,
): Promise<string[]> {
	const lookup = input.lookup ?? systemLookup;
	const { server } = input;
	const ours = new Set(
		[server.ipv4, server.ipv6].filter(Boolean).map((a) => a!.toLowerCase()),
	);
	const bad: MisdirectedHost[] = [];
	const ok: string[] = [];
	for (const host of input.hosts) {
		let resolved: string[];
		try {
			resolved = [...new Set(await lookup(host))];
		} catch (error) {
			const code =
				error && typeof error === 'object' && 'code' in error
					? String((error as { code: unknown }).code)
					: error instanceof Error
						? error.message
						: String(error);
			bad.push({ host, resolved: [], error: code });
			continue;
		}
		const pointsHere =
			resolved.some((a) => a.toLowerCase() === server.ipv4.toLowerCase()) &&
			resolved.every((a) => ours.has(a.toLowerCase()));
		if (pointsHere) ok.push(host);
		else bad.push({ host, resolved });
	}

	if (bad.length > 0) {
		throw new HostNotPointingAtServer(
			input.stage,
			bad,
			{ ipv4: server.ipv4, ...(server.ipv6 ? { ipv6: server.ipv6 } : {}) },
			dnsFix(input, bad),
		);
	}
	return ok;
}

/** How to fix it: `gkm setup`, or the records to create by hand. */
function dnsFix(input: CheckStackDnsInput, bad: readonly MisdirectedHost[]) {
	const hosts = bad.map((h) => h.host);
	let plan: StackDnsPlan;
	try {
		plan = planStackDns({
			stage: input.stage,
			hosts,
			server: input.server,
			dns: input.dns,
		});
	} catch {
		plan = {
			stage: input.stage,
			server: input.server,
			domains: [],
			uncovered: hosts,
		};
	}
	const automatic = plan.domains.filter((d) => d.provider !== 'manual');
	const byHand = [
		...plan.domains
			.filter((d) => d.provider === 'manual')
			.flatMap((d) => d.records.map(describe)),
		...plan.uncovered.flatMap((host) => [
			`${host.padEnd(32)} A     ${input.server.ipv4}`,
			...(input.server.ipv6
				? [`${host.padEnd(32)} AAAA  ${input.server.ipv6}`]
				: []),
		]),
	];
	const lines: string[] = [];
	if (automatic.length > 0) {
		lines.push(
			`Fix: gkm setup --stage ${input.stage} writes the records for ${automatic.map((d) => d.domain).join(', ')} (gkm setup --stage ${input.stage} --dry-run shows them first).`,
		);
	}
	if (byHand.length > 0) {
		lines.push(
			`${automatic.length > 0 ? 'And create' : 'Fix: create'} these records at the DNS host:`,
			...byHand.map((line) => `    ${line}`),
		);
	}
	return lines.join('\n');
}
