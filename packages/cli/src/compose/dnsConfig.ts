/**
 * `dns['<root domain>'].records` — how a domain's hosts point at a compose
 * stage's server — checked and read. Pure, and kept apart from the DNS step
 * so the workspace schema checks a config with the same rules and the same
 * named errors the step applies.
 */

/** The stage-secret key holding the server's public IPv4 address. */
export const SERVER_IPV4_KEY = 'GKM_SERVER_IPV4';
/** The stage-secret key holding the server's public IPv6 address, if any. */
export const SERVER_IPV6_KEY = 'GKM_SERVER_IPV6';

/**
 * Whether a stage secret is gkm's own — the server's address — and so never
 * written into an app's or a worker's environment.
 */
export function isReservedStageKey(key: string): boolean {
	return key.startsWith('GKM_SERVER_');
}

/** A records mode as written: `'a'`, or a CNAME target — one, or per stage. */
export type DnsRecordsMode =
	| 'a'
	| {
			mode: 'cname';
			target: string | Readonly<Record<string, string>>;
	  };

/** A DNS hostname: dot-separated labels of letters, digits and inner '-'. */
const HOSTNAME =
	/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Whether `value` is a DNS hostname with at least two labels. */
export function isHostname(value: unknown): value is string {
	return typeof value === 'string' && HOSTNAME.test(value);
}

/** A CNAME target that is not a hostname under its own domain. */
export class DnsTargetInvalid extends Error {
	constructor(
		readonly domain: string,
		readonly target: unknown,
		readonly stage?: string,
	) {
		super(
			`dns['${domain}'].records.target${stage ? ` for '${stage}'` : ''} is ` +
				`${JSON.stringify(target)}, which is not a hostname under ${domain}. ` +
				"Every host's CNAME points at it and gkm writes its A record, so it " +
				`must be a name in the same zone — like 'server.${domain}'.`,
		);
		this.name = 'DnsTargetInvalid';
	}
}

/** The CNAME target names under one domain, by the stage they are for, checked. */
function targets(records: {
	target?: unknown;
}): [string | undefined, unknown][] {
	const { target } = records;
	if (target && typeof target === 'object' && !Array.isArray(target)) {
		return Object.entries(target);
	}
	return [[undefined, target]];
}

/**
 * One domain's records mode checked.
 *
 * @throws {DnsTargetInvalid} for a target that is not a hostname under it
 */
export function checkDnsRecordsMode(domain: string, records: unknown): void {
	if (!records || typeof records !== 'object') return;
	const mode = records as { mode?: unknown; target?: unknown };
	if (mode.mode !== 'cname') return;
	for (const [stage, target] of targets(mode)) {
		const name = typeof target === 'string' ? target.toLowerCase() : target;
		if (
			!isHostname(name) ||
			!(name as string).endsWith(`.${domain.toLowerCase()}`)
		) {
			throw new DnsTargetInvalid(domain, target, stage);
		}
	}
}

/**
 * The CNAME target a domain's hosts point at on `stage`, or `undefined` for
 * A records — including a per-stage map that names no target for it.
 */
export function cnameTarget(
	records: DnsRecordsMode | undefined,
	stage: string,
): string | undefined {
	if (!records || records === 'a') return undefined;
	const target =
		typeof records.target === 'string' ? records.target : records.target[stage];
	return target?.toLowerCase();
}
