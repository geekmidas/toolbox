/**
 * DNS records gkm wrote for a stage, as resource records in its deploy state.
 *
 * Each is `dns-record:<fqdn>:<type>` — `dns-record:api.example.com:A` — with
 * `id` `<fqdn> <type>` and the record's value in `data`. Every deploy's DNS
 * step writes through here — `gkm deploy`, `gkm compose` and a CI runner's
 * `--resources-only` alike — so each record has one key, whoever wrote it.
 */

import type { DeployJournal } from './journal';
import type { ResourceInput, ResourceRecord } from './StateStore';

/** The resource type of a DNS record gkm wrote. */
export const DNS_RECORD_RESOURCE = 'dns-record';

/** A DNS record as gkm writes it. */
export interface DnsResourceRecord {
	/** The `dns` domain it is under: `example.com`. */
	domain: string;
	/** Relative to the domain, as providers take it: `api`, `@`. */
	name: string;
	type: string;
	value: string;
	ttl: number;
	/**
	 * The domain's provider — `godaddy`, `route53`, … Absent on a record
	 * migrated from a v2 state, which did not say.
	 */
	provider?: string;
}

/** `data` of a `dns-record` resource. */
export type DnsResourceData = Omit<DnsResourceRecord, 'type'>;

/** A record's full name: `api.example.com`, or the domain for `@`. */
export function dnsRecordFqdn(domain: string, name: string): string {
	return name === '@' || name === '' ? domain : `${name}.${domain}`;
}

/** `dns-record:<fqdn>:<type>` */
export function dnsResourceKey(fqdn: string, type: string): string {
	return `${DNS_RECORD_RESOURCE}:${fqdn.toLowerCase()}:${type.toUpperCase()}`;
}

/** The resource record a written DNS record is kept as. */
export function dnsRecordResource(record: DnsResourceRecord): ResourceInput {
	const fqdn = dnsRecordFqdn(record.domain, record.name).toLowerCase();
	const type = record.type.toUpperCase();
	const data: DnsResourceData = {
		domain: record.domain,
		name: record.name,
		value: record.value,
		ttl: record.ttl,
		...(record.provider ? { provider: record.provider } : {}),
	};
	return {
		key: dnsResourceKey(fqdn, type),
		type: DNS_RECORD_RESOURCE,
		id: `${fqdn} ${type}`,
		status: 'ready',
		data,
	};
}

/** Records that gkm wrote `record` — or updates the value it holds. */
export async function recordDnsResource(
	journal: DeployJournal,
	record: DnsResourceRecord,
): Promise<void> {
	const { key, type, id, data } = dnsRecordResource(record);
	await journal.ready({ key, type, ...(data ? { data } : {}) }, id!);
}

/** Forgets a DNS record gkm deleted. */
export async function forgetDnsResource(
	journal: DeployJournal,
	record: Pick<DnsResourceRecord, 'domain' | 'name' | 'type'>,
): Promise<void> {
	await journal.forget(
		dnsResourceKey(dnsRecordFqdn(record.domain, record.name), record.type),
	);
}

/** One change a DNS step made, as `applyStackDns` reports it. */
export interface AppliedDnsChange {
	domain: string;
	name: string;
	type: string;
	action: string;
	value?: string;
	ttl?: number;
}

/**
 * The changes a DNS step made, kept: what it created, updated or wrote is
 * recorded, what it deleted is forgotten. A record it found already right is
 * recorded only if gkm wrote it before; one it left to a person is not.
 */
export async function recordDnsChanges(
	journal: DeployJournal,
	changes: readonly AppliedDnsChange[],
	providerOf: (domain: string) => string | undefined,
): Promise<void> {
	for (const change of changes) {
		if (change.action === 'delete') {
			await forgetDnsResource(journal, change);
			continue;
		}
		const written =
			change.action === 'create' ||
			change.action === 'update' ||
			change.action === 'write';
		const known =
			change.action === 'unchanged' &&
			journal.record(
				dnsResourceKey(dnsRecordFqdn(change.domain, change.name), change.type),
			) !== undefined;
		if ((!written && !known) || change.value === undefined) continue;
		const provider = providerOf(change.domain);
		await recordDnsResource(journal, {
			domain: change.domain,
			name: change.name,
			type: change.type,
			value: change.value,
			ttl: change.ttl ?? 0,
			...(provider ? { provider } : {}),
		});
	}
}

/** Every DNS record gkm wrote for the stage, from its resource records. */
export function dnsResources(
	resources: Record<string, ResourceRecord>,
): (DnsResourceRecord & { fqdn: string })[] {
	return Object.values(resources)
		.filter((record) => record.type === DNS_RECORD_RESOURCE)
		.map((record) => {
			const data = (record.data ?? {}) as DnsResourceData;
			const [fqdn = '', type = ''] = (record.id ?? '').split(' ');
			return { ...data, type, fqdn };
		})
		.sort(
			(a, b) => a.fqdn.localeCompare(b.fqdn) || a.type.localeCompare(b.type),
		);
}
