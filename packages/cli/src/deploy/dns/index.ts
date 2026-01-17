/**
 * DNS orchestration for deployments
 *
 * Handles automatic DNS record creation for deployed applications.
 */

import { lookup } from 'node:dns/promises';
import type { DnsConfig } from '../../workspace/types';
import {
	type DokployStageState,
	isDnsVerified,
	setDnsVerification,
} from '../state';
import {
	createDnsProvider,
	type DnsConfig as SchemaDnsConfig,
	type DnsProvider,
	type UpsertDnsRecord,
} from './DnsProvider';

const logger = console;

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
 * Create DNS records using the configured provider
 */
export async function createDnsRecords(
	records: RequiredDnsRecord[],
	dnsConfig: DnsConfig,
): Promise<RequiredDnsRecord[]> {
	const rootDomain = dnsConfig.domain;
	// Get TTL from config, default to 300. Manual mode doesn't have ttl property.
	const ttl = 'ttl' in dnsConfig && dnsConfig.ttl ? dnsConfig.ttl : 300;

	// Get DNS provider from factory
	let provider: DnsProvider | null;
	try {
		// Cast to schema-derived DnsConfig for provider factory
		provider = await createDnsProvider({
			config: dnsConfig as SchemaDnsConfig,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.log(`   ⚠ Failed to create DNS provider: ${message}`);
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
		logger.log(`   ⚠ Failed to create DNS records: ${message}`);
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
 * Main DNS orchestration function for deployments
 */
export async function orchestrateDns(
	appHostnames: Map<string, string>, // appName -> hostname
	dnsConfig: DnsConfig | undefined,
	dokployEndpoint: string,
): Promise<DnsCreationResult | null> {
	if (!dnsConfig) {
		return null;
	}

	const { domain: rootDomain, provider: providerName } = dnsConfig;

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

	// Generate required records
	const requiredRecords = generateRequiredRecords(
		appHostnames,
		rootDomain,
		serverIp,
	);

	if (requiredRecords.length === 0) {
		logger.log('   No DNS records needed');
		return { records: [], success: true, serverIp };
	}

	// Create records (if manual mode, createDnsRecords will mark them as needing manual creation)
	logger.log(`   Creating DNS records at ${providerName}...`);
	const finalRecords = await createDnsRecords(requiredRecords, dnsConfig);

	const created = finalRecords.filter((r) => r.created).length;
	const existed = finalRecords.filter((r) => r.existed).length;
	const failed = finalRecords.filter((r) => r.error).length;

	if (created > 0) {
		logger.log(`   ✓ Created ${created} DNS record(s)`);
	}
	if (existed > 0) {
		logger.log(`   ✓ ${existed} record(s) already exist`);
	}
	if (failed > 0) {
		logger.log(`   ⚠ ${failed} record(s) failed`);
	}

	// Print summary table
	printDnsRecordsTable(finalRecords, rootDomain);

	// If manual mode or some failed, print simple instructions
	const hasFailures = finalRecords.some((r) => r.error);
	if (dnsConfig.provider === 'manual' || hasFailures) {
		printDnsRecordsSimple(
			finalRecords.filter((r) => !r.created && !r.existed),
			rootDomain,
		);
	}

	return {
		records: finalRecords,
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
