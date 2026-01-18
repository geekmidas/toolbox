/**
 * DNS orchestration for deployments
 *
 * Handles automatic DNS record creation for deployed applications.
 */

import { lookup } from 'node:dns/promises';
import type { DnsConfig, DnsProvider as DnsProviderConfig } from '../../workspace/types';
import {
	type DokployStageState,
	isDnsVerified,
	setDnsVerification,
} from '../state';
import {
	createDnsProvider,
	type DnsProvider,
	type DnsConfig as SchemaDnsConfig,
	type UpsertDnsRecord,
} from './DnsProvider';

const logger = console;

/**
 * Check if DNS config is legacy format (single domain with `domain` property)
 */
export function isLegacyDnsConfig(
	config: DnsConfig,
): config is SchemaDnsConfig & { domain: string } {
	return (
		typeof config === 'object' &&
		config !== null &&
		'provider' in config &&
		'domain' in config
	);
}

/**
 * Normalize DNS config to new multi-domain format
 */
export function normalizeDnsConfig(
	config: DnsConfig,
): Record<string, DnsProviderConfig> {
	if (isLegacyDnsConfig(config)) {
		// Convert legacy format to new format
		const { domain, ...providerConfig } = config;
		return { [domain]: providerConfig as DnsProviderConfig };
	}
	return config as Record<string, DnsProviderConfig>;
}

/**
 * Find the root domain for a hostname from available DNS configs
 *
 * @example
 * findRootDomain('api.geekmidas.com', { 'geekmidas.com': {...}, 'geekmidas.dev': {...} })
 * // Returns 'geekmidas.com'
 */
export function findRootDomain(
	hostname: string,
	dnsConfig: Record<string, DnsProviderConfig>,
): string | null {
	// Sort domains by length descending to match most specific first
	const domains = Object.keys(dnsConfig).sort((a, b) => b.length - a.length);

	for (const domain of domains) {
		if (hostname === domain || hostname.endsWith(`.${domain}`)) {
			return domain;
		}
	}

	return null;
}

/**
 * Group hostnames by their root domain
 */
export function groupHostnamesByDomain(
	appHostnames: Map<string, string>,
	dnsConfig: Record<string, DnsProviderConfig>,
): Map<string, Map<string, string>> {
	const grouped = new Map<string, Map<string, string>>();

	for (const [appName, hostname] of appHostnames) {
		const rootDomain = findRootDomain(hostname, dnsConfig);
		if (!rootDomain) {
			logger.log(`   ⚠ No DNS config found for hostname: ${hostname}`);
			continue;
		}

		if (!grouped.has(rootDomain)) {
			grouped.set(rootDomain, new Map());
		}
		grouped.get(rootDomain)!.set(appName, hostname);
	}

	return grouped;
}

/**
 * Required DNS record for an app
 */
export interface RequiredDnsRecord {
	/** Full hostname (e.g., 'api.joemoer.traflabs.io') */
	hostname: string;
	/** Subdomain part for the DNS provider (e.g., 'api.joemoer') */
	subdomain: string;
	/** Record type */
	type: 'A' | 'CNAME';
	/** Target value (IP or hostname) */
	value: string;
	/** App name */
	appName: string;
	/** Whether the record was created */
	created?: boolean;
	/** Whether the record already existed */
	existed?: boolean;
	/** Error if creation failed */
	error?: string;
}

/**
 * Result of DNS record creation
 */
export interface DnsCreationResult {
	records: RequiredDnsRecord[];
	success: boolean;
	serverIp: string;
}

/**
 * Resolve IP address from a hostname
 */
export async function resolveHostnameToIp(hostname: string): Promise<string> {
	try {
		const addresses = await lookup(hostname, { family: 4 });
		return addresses.address;
	} catch (error) {
		throw new Error(
			`Failed to resolve IP for ${hostname}: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}

/**
 * Extract subdomain from full hostname relative to root domain
 *
 * @example
 * extractSubdomain('api.joemoer.traflabs.io', 'traflabs.io') => 'api.joemoer'
 * extractSubdomain('joemoer.traflabs.io', 'traflabs.io') => 'joemoer'
 */
export function extractSubdomain(hostname: string, rootDomain: string): string {
	if (!hostname.endsWith(rootDomain)) {
		throw new Error(
			`Hostname ${hostname} is not under root domain ${rootDomain}`,
		);
	}

	const subdomain = hostname.slice(0, -(rootDomain.length + 1)); // +1 for the dot
	return subdomain || '@'; // '@' represents the root domain itself
}

/**
 * Generate required DNS records for a deployment
 */
export function generateRequiredRecords(
	appHostnames: Map<string, string>, // appName -> hostname
	rootDomain: string,
	serverIp: string,
): RequiredDnsRecord[] {
	const records: RequiredDnsRecord[] = [];

	for (const [appName, hostname] of appHostnames) {
		const subdomain = extractSubdomain(hostname, rootDomain);
		records.push({
			hostname,
			subdomain,
			type: 'A',
			value: serverIp,
			appName,
		});
	}

	return records;
}

/**
 * Print DNS records table
 */
export function printDnsRecordsTable(
	records: RequiredDnsRecord[],
	rootDomain: string,
): void {
	logger.log(`\n   📋 DNS Records for ${rootDomain}:`);
	logger.log(
		'   ┌─────────────────────────────────────┬──────┬─────────────────┬────────┐',
	);
	logger.log(
		'   │ Subdomain                           │ Type │ Value           │ Status │',
	);
	logger.log(
		'   ├─────────────────────────────────────┼──────┼─────────────────┼────────┤',
	);

	for (const record of records) {
		const subdomain = record.subdomain.padEnd(35);
		const type = record.type.padEnd(4);
		const value = record.value.padEnd(15);
		let status: string;

		if (record.error) {
			status = '✗';
		} else if (record.created) {
			status = '✓ new';
		} else if (record.existed) {
			status = '✓';
		} else {
			status = '?';
		}

		logger.log(
			`   │ ${subdomain} │ ${type} │ ${value} │ ${status.padEnd(6)} │`,
		);
	}

	logger.log(
		'   └─────────────────────────────────────┴──────┴─────────────────┴────────┘',
	);
}

/**
 * Print DNS records in a simple format for manual setup
 */
export function printDnsRecordsSimple(
	records: RequiredDnsRecord[],
	rootDomain: string,
): void {
	logger.log('\n   📋 Required DNS Records:');
	logger.log(`   Add these A records to your DNS provider (${rootDomain}):\n`);

	for (const record of records) {
		logger.log(`   ${record.subdomain}  →  ${record.value}  (A record)`);
	}

	logger.log('');
}

/**
 * Create DNS records for a single domain using its configured provider
 */
export async function createDnsRecordsForDomain(
	records: RequiredDnsRecord[],
	rootDomain: string,
	providerConfig: DnsProviderConfig,
): Promise<RequiredDnsRecord[]> {
	// Get TTL from config, default to 300. Manual mode doesn't have ttl property.
	const ttl = 'ttl' in providerConfig && providerConfig.ttl ? providerConfig.ttl : 300;

	// Get DNS provider from factory
	let provider: DnsProvider | null;
	try {
		// Cast to schema-derived DnsConfig for provider factory
		provider = await createDnsProvider({
			config: providerConfig as SchemaDnsConfig,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.log(`   ⚠ Failed to create DNS provider for ${rootDomain}: ${message}`);
		return records.map((r) => ({ ...r, error: message }));
	}

	// Manual mode - no provider, just mark records as needing manual creation
	if (!provider) {
		return records.map((r) => ({ ...r, created: false, existed: false }));
	}

	const results: RequiredDnsRecord[] = [];

	// Convert RequiredDnsRecord to UpsertDnsRecord format
	const upsertRecords: UpsertDnsRecord[] = records.map((r) => ({
		name: r.subdomain,
		type: r.type,
		ttl,
		value: r.value,
	}));

	try {
		// Use provider to upsert records
		const upsertResults = await provider.upsertRecords(
			rootDomain,
			upsertRecords,
		);

		// Map results back to RequiredDnsRecord format
		for (const [i, record] of records.entries()) {
			const result = upsertResults[i];

			// Handle case where upsertResults has fewer items (shouldn't happen but be safe)
			if (!result) {
				results.push({
					hostname: record.hostname,
					subdomain: record.subdomain,
					type: record.type,
					value: record.value,
					appName: record.appName,
					error: 'No result returned from provider',
				});
				continue;
			}

			if (result.unchanged) {
				results.push({
					hostname: record.hostname,
					subdomain: record.subdomain,
					type: record.type,
					value: record.value,
					appName: record.appName,
					existed: true,
					created: false,
				});
			} else {
				results.push({
					hostname: record.hostname,
					subdomain: record.subdomain,
					type: record.type,
					value: record.value,
					appName: record.appName,
					created: result.created,
					existed: !result.created,
				});
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.log(`   ⚠ Failed to create DNS records for ${rootDomain}: ${message}`);
		return records.map((r) => ({
			hostname: r.hostname,
			subdomain: r.subdomain,
			type: r.type,
			value: r.value,
			appName: r.appName,
			error: message,
		}));
	}

	return results;
}

/**
 * Create DNS records using the configured provider
 * @deprecated Use createDnsRecordsForDomain for multi-domain support
 */
export async function createDnsRecords(
	records: RequiredDnsRecord[],
	dnsConfig: DnsConfig,
): Promise<RequiredDnsRecord[]> {
	// Handle legacy config format
	if (!isLegacyDnsConfig(dnsConfig)) {
		throw new Error('createDnsRecords requires legacy DnsConfig with domain property. Use createDnsRecordsForDomain instead.');
	}
	const { domain: rootDomain, ...providerConfig } = dnsConfig;
	return createDnsRecordsForDomain(records, rootDomain, providerConfig as DnsProviderConfig);
}

/**
 * Main DNS orchestration function for deployments
 *
 * Supports both legacy single-domain format and new multi-domain format:
 * - Legacy: { provider: 'hostinger', domain: 'example.com' }
 * - Multi:  { 'example.com': { provider: 'hostinger' }, 'example.dev': { provider: 'route53' } }
 */
export async function orchestrateDns(
	appHostnames: Map<string, string>, // appName -> hostname
	dnsConfig: DnsConfig | undefined,
	dokployEndpoint: string,
): Promise<DnsCreationResult | null> {
	if (!dnsConfig) {
		return null;
	}

	// Normalize config to multi-domain format
	const normalizedConfig = normalizeDnsConfig(dnsConfig);

	// Resolve Dokploy server IP from endpoint
	logger.log('\n🌐 Setting up DNS records...');
	let serverIp: string;

	try {
		const endpointUrl = new URL(dokployEndpoint);
		serverIp = await resolveHostnameToIp(endpointUrl.hostname);
		logger.log(`   Server IP: ${serverIp} (from ${endpointUrl.hostname})`);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.log(`   ⚠ Failed to resolve server IP: ${message}`);
		return null;
	}

	// Group hostnames by their root domain
	const groupedHostnames = groupHostnamesByDomain(appHostnames, normalizedConfig);

	if (groupedHostnames.size === 0) {
		logger.log('   No DNS records needed (no hostnames match configured domains)');
		return { records: [], success: true, serverIp };
	}

	const allRecords: RequiredDnsRecord[] = [];
	let hasFailures = false;

	// Process each domain group with its specific provider
	for (const [rootDomain, domainHostnames] of groupedHostnames) {
		const providerConfig = normalizedConfig[rootDomain];
		if (!providerConfig) {
			logger.log(`   ⚠ No provider config for ${rootDomain}`);
			continue;
		}

		const providerName = typeof providerConfig.provider === 'string'
			? providerConfig.provider
			: 'custom';

		// Generate required records for this domain
		const requiredRecords = generateRequiredRecords(
			domainHostnames,
			rootDomain,
			serverIp,
		);

		if (requiredRecords.length === 0) {
			continue;
		}

		// Create records for this domain
		logger.log(`   Creating DNS records for ${rootDomain} (${providerName})...`);
		const domainRecords = await createDnsRecordsForDomain(
			requiredRecords,
			rootDomain,
			providerConfig,
		);

		allRecords.push(...domainRecords);

		const created = domainRecords.filter((r) => r.created).length;
		const existed = domainRecords.filter((r) => r.existed).length;
		const failed = domainRecords.filter((r) => r.error).length;

		if (created > 0) {
			logger.log(`   ✓ Created ${created} DNS record(s) for ${rootDomain}`);
		}
		if (existed > 0) {
			logger.log(`   ✓ ${existed} record(s) already exist for ${rootDomain}`);
		}
		if (failed > 0) {
			logger.log(`   ⚠ ${failed} record(s) failed for ${rootDomain}`);
			hasFailures = true;
		}

		// Print summary table for this domain
		printDnsRecordsTable(domainRecords, rootDomain);

		// If manual mode or some failed, print simple instructions
		if (providerConfig.provider === 'manual' || failed > 0) {
			printDnsRecordsSimple(
				domainRecords.filter((r) => !r.created && !r.existed),
				rootDomain,
			);
		}
	}

	return {
		records: allRecords,
		success: !hasFailures,
		serverIp,
	};
}

/**
 * Result of DNS verification for a single hostname
 */
export interface DnsVerificationResult {
	hostname: string;
	appName: string;
	verified: boolean;
	resolvedIp?: string;
	expectedIp: string;
	error?: string;
	skipped?: boolean; // True if already verified in state
}

/**
 * Verify DNS records resolve correctly after deployment.
 *
 * This function:
 * 1. Checks state for previously verified hostnames (skips if already verified with same IP)
 * 2. Attempts to resolve each hostname to an IP
 * 3. Compares resolved IP with expected server IP
 * 4. Updates state with verification results
 *
 * @param appHostnames - Map of app names to hostnames
 * @param serverIp - Expected IP address the hostnames should resolve to
 * @param state - Deploy state for caching verification results
 * @returns Array of verification results
 */
export async function verifyDnsRecords(
	appHostnames: Map<string, string>,
	serverIp: string,
	state: DokployStageState,
): Promise<DnsVerificationResult[]> {
	const results: DnsVerificationResult[] = [];

	logger.log('\n🔍 Verifying DNS records...');

	for (const [appName, hostname] of appHostnames) {
		// Check if already verified with same IP
		if (isDnsVerified(state, hostname, serverIp)) {
			logger.log(`   ✓ ${hostname} (previously verified)`);
			results.push({
				hostname,
				appName,
				verified: true,
				expectedIp: serverIp,
				skipped: true,
			});
			continue;
		}

		// Attempt to resolve hostname
		try {
			const resolvedIp = await resolveHostnameToIp(hostname);

			if (resolvedIp === serverIp) {
				// DNS verified successfully
				setDnsVerification(state, hostname, serverIp);
				logger.log(`   ✓ ${hostname} → ${resolvedIp}`);
				results.push({
					hostname,
					appName,
					verified: true,
					resolvedIp,
					expectedIp: serverIp,
				});
			} else {
				// DNS resolves but to wrong IP
				logger.log(
					`   ⚠ ${hostname} resolves to ${resolvedIp}, expected ${serverIp}`,
				);
				results.push({
					hostname,
					appName,
					verified: false,
					resolvedIp,
					expectedIp: serverIp,
				});
			}
		} catch (error) {
			// DNS resolution failed
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.log(`   ⚠ ${hostname} DNS not propagated (${message})`);
			results.push({
				hostname,
				appName,
				verified: false,
				expectedIp: serverIp,
				error: message,
			});
		}
	}

	// Summary
	const verified = results.filter((r) => r.verified).length;
	const skipped = results.filter((r) => r.skipped).length;
	const pending = results.filter((r) => !r.verified).length;

	if (pending > 0) {
		logger.log(`\n   ${verified} verified, ${pending} pending propagation`);
		logger.log('   DNS changes may take 5-30 minutes to propagate');
	} else if (skipped > 0) {
		logger.log(`   ${verified} verified (${skipped} from cache)`);
	}

	return results;
}
