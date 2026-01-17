/**
 * DNS orchestration for deployments
 *
 * Handles automatic DNS record creation for deployed applications.
 */

import { lookup } from 'node:dns/promises';
import { getHostingerToken, storeHostingerToken } from '../../auth/credentials';
import type { DnsConfig } from '../../workspace/types';
import { HostingerApi } from './hostinger-api';

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
 * Prompt for input (reuse from deploy/index.ts pattern)
 */
async function promptForToken(message: string): Promise<string> {
	const { stdin, stdout } = await import('node:process');

	if (!stdin.isTTY) {
		throw new Error('Interactive input required for Hostinger token.');
	}

	// Hidden input for token
	stdout.write(message);
	return new Promise((resolve) => {
		let value = '';
		const onData = (char: Buffer) => {
			const c = char.toString();
			if (c === '\n' || c === '\r') {
				stdin.setRawMode(false);
				stdin.pause();
				stdin.removeListener('data', onData);
				stdout.write('\n');
				resolve(value);
			} else if (c === '\u0003') {
				stdin.setRawMode(false);
				stdin.pause();
				stdout.write('\n');
				process.exit(1);
			} else if (c === '\u007F' || c === '\b') {
				if (value.length > 0) value = value.slice(0, -1);
			} else {
				value += c;
			}
		};
		stdin.setRawMode(true);
		stdin.resume();
		stdin.on('data', onData);
	});
}

/**
 * Create DNS records using the configured provider
 */
export async function createDnsRecords(
	records: RequiredDnsRecord[],
	dnsConfig: DnsConfig,
): Promise<RequiredDnsRecord[]> {
	const { provider, domain: rootDomain, ttl = 300 } = dnsConfig;

	if (provider === 'manual') {
		// Just mark all records as needing manual creation
		return records.map((r) => ({ ...r, created: false, existed: false }));
	}

	if (provider === 'hostinger') {
		return createHostingerRecords(records, rootDomain, ttl);
	}

	if (provider === 'cloudflare') {
		logger.log('   ⚠ Cloudflare DNS integration not yet implemented');
		return records.map((r) => ({
			...r,
			error: 'Cloudflare not implemented',
		}));
	}

	return records;
}

/**
 * Create DNS records at Hostinger
 */
async function createHostingerRecords(
	records: RequiredDnsRecord[],
	rootDomain: string,
	ttl: number,
): Promise<RequiredDnsRecord[]> {
	// Get or prompt for Hostinger token
	let token = await getHostingerToken();

	if (!token) {
		logger.log('\n   📋 Hostinger API token not found.');
		logger.log(
			'   Get your token from: https://hpanel.hostinger.com/profile/api\n',
		);

		try {
			token = await promptForToken('   Hostinger API Token: ');
			await storeHostingerToken(token);
			logger.log('   ✓ Token saved');
		} catch {
			logger.log('   ⚠ Could not get token, skipping DNS creation');
			return records.map((r) => ({
				...r,
				error: 'No API token',
			}));
		}
	}

	const api = new HostingerApi(token);
	const results: RequiredDnsRecord[] = [];

	// Get existing records to check what already exists
	let existingRecords: Awaited<ReturnType<typeof api.getRecords>> = [];
	try {
		existingRecords = await api.getRecords(rootDomain);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.log(`   ⚠ Failed to fetch existing DNS records: ${message}`);
		return records.map((r) => ({ ...r, error: message }));
	}

	// Process each record
	for (const record of records) {
		const existing = existingRecords.find(
			(r) => r.name === record.subdomain && r.type === 'A',
		);

		if (existing) {
			// Record already exists
			results.push({
				...record,
				existed: true,
				created: false,
			});
			continue;
		}

		// Create the record
		try {
			await api.upsertRecords(rootDomain, [
				{
					name: record.subdomain,
					type: 'A',
					ttl,
					records: [{ content: record.value }],
				},
			]);

			results.push({
				...record,
				created: true,
				existed: false,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			results.push({
				...record,
				error: message,
			});
		}
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

	const { domain: rootDomain, autoCreate = true } = dnsConfig;

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

	// Create records if auto-create is enabled
	let finalRecords: RequiredDnsRecord[];

	if (autoCreate && dnsConfig.provider !== 'manual') {
		logger.log(`   Creating DNS records at ${dnsConfig.provider}...`);
		finalRecords = await createDnsRecords(requiredRecords, dnsConfig);

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
	} else {
		finalRecords = requiredRecords;
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
