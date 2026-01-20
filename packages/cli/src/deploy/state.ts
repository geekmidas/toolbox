/**
 * Deploy state management for Dokploy deployments
 *
 * Stores resource IDs (applications, services) per stage to avoid
 * re-creating resources on subsequent deploys.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Per-app database credentials
 */
export interface AppDbCredentials {
	dbUser: string;
	dbPassword: string;
}

/**
 * DNS verification record for a hostname
 */
export interface DnsVerificationRecord {
	serverIp: string;
	verifiedAt: string;
}

/**
 * A DNS record that was created during deploy
 */
export interface CreatedDnsRecord {
	/** The domain this record belongs to (e.g., 'example.com') */
	domain: string;
	/** Record name/subdomain (e.g., 'api' or '@' for root) */
	name: string;
	/** Record type (A, CNAME, etc.) */
	type: string;
	/** Record value (IP address, hostname, etc.) */
	value: string;
	/** TTL in seconds */
	ttl: number;
	/** When this record was created */
	createdAt: string;
}

/**
 * Backup destination state
 */
export interface BackupState {
	/** S3 bucket name for backups */
	bucketName: string;
	/** S3 bucket ARN */
	bucketArn: string;
	/** IAM user name created for backup access */
	iamUserName: string;
	/** IAM access key ID */
	iamAccessKeyId: string;
	/** IAM secret access key */
	iamSecretAccessKey: string;
	/** Dokploy destination ID */
	destinationId: string;
	/** Dokploy backup schedule ID for postgres (if configured) */
	postgresBackupId?: string;
	/** AWS region where bucket was created */
	region: string;
	/** Timestamp when backup was configured */
	createdAt: string;
}

/**
 * State for a single stage deployment
 */
export interface DokployStageState {
	provider: 'dokploy';
	stage: string;
	/** Dokploy project ID - created on first deploy */
	projectId: string;
	environmentId: string;
	applications: Record<string, string>; // appName -> applicationId
	services: {
		postgresId?: string;
		redisId?: string;
	};
	/** Per-app database credentials for reuse on subsequent deploys */
	appCredentials?: Record<string, AppDbCredentials>;
	/** Auto-generated secrets per app (e.g., BETTER_AUTH_SECRET) */
	generatedSecrets?: Record<string, Record<string, string>>;
	/** DNS verification state per hostname */
	dnsVerified?: Record<string, DnsVerificationRecord>;
	/** DNS records created during deploy (keyed by "name:type", e.g., "api:A") */
	dnsRecords?: Record<string, CreatedDnsRecord>;
	/** Backup destination state */
	backups?: BackupState;
	lastDeployedAt: string;
}

/**
 * Get the state file path for a stage
 */
function getStateFilePath(workspaceRoot: string, stage: string): string {
	return join(workspaceRoot, '.gkm', `deploy-${stage}.json`);
}

/**
 * Read the deploy state for a stage
 * Returns null if state file doesn't exist
 */
export async function readStageState(
	workspaceRoot: string,
	stage: string,
): Promise<DokployStageState | null> {
	const filePath = getStateFilePath(workspaceRoot, stage);

	try {
		const content = await readFile(filePath, 'utf-8');
		return JSON.parse(content) as DokployStageState;
	} catch (error) {
		// File doesn't exist or is invalid - return null
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		// Log other errors but don't fail
		console.warn(`Warning: Could not read deploy state: ${error}`);
		return null;
	}
}

/**
 * Write the deploy state for a stage
 */
export async function writeStageState(
	workspaceRoot: string,
	stage: string,
	state: DokployStageState,
): Promise<void> {
	const filePath = getStateFilePath(workspaceRoot, stage);
	const dir = join(workspaceRoot, '.gkm');

	// Ensure .gkm directory exists
	await mkdir(dir, { recursive: true });

	// Update last deployed timestamp
	state.lastDeployedAt = new Date().toISOString();

	await writeFile(filePath, JSON.stringify(state, null, 2));
}

/**
 * Create a new empty state for a stage
 */
export function createEmptyState(
	stage: string,
	projectId: string,
	environmentId: string,
): DokployStageState {
	return {
		provider: 'dokploy',
		stage,
		projectId,
		environmentId,
		applications: {},
		services: {},
		lastDeployedAt: new Date().toISOString(),
	};
}

/**
 * Get application ID from state
 */
export function getApplicationId(
	state: DokployStageState | null,
	appName: string,
): string | undefined {
	return state?.applications[appName];
}

/**
 * Set application ID in state (mutates state)
 */
export function setApplicationId(
	state: DokployStageState,
	appName: string,
	applicationId: string,
): void {
	state.applications[appName] = applicationId;
}

/**
 * Get postgres ID from state
 */
export function getPostgresId(
	state: DokployStageState | null,
): string | undefined {
	return state?.services.postgresId;
}

/**
 * Set postgres ID in state (mutates state)
 */
export function setPostgresId(
	state: DokployStageState,
	postgresId: string,
): void {
	state.services.postgresId = postgresId;
}

/**
 * Get redis ID from state
 */
export function getRedisId(
	state: DokployStageState | null,
): string | undefined {
	return state?.services.redisId;
}

/**
 * Set redis ID in state (mutates state)
 */
export function setRedisId(state: DokployStageState, redisId: string): void {
	state.services.redisId = redisId;
}

/**
 * Get app credentials from state
 */
export function getAppCredentials(
	state: DokployStageState | null,
	appName: string,
): AppDbCredentials | undefined {
	return state?.appCredentials?.[appName];
}

/**
 * Set app credentials in state (mutates state)
 */
export function setAppCredentials(
	state: DokployStageState,
	appName: string,
	credentials: AppDbCredentials,
): void {
	if (!state.appCredentials) {
		state.appCredentials = {};
	}
	state.appCredentials[appName] = credentials;
}

/**
 * Get all app credentials from state
 */
export function getAllAppCredentials(
	state: DokployStageState | null,
): Record<string, AppDbCredentials> {
	return state?.appCredentials ?? {};
}

// ============================================================================
// Generated Secrets
// ============================================================================

/**
 * Get a generated secret for an app
 */
export function getGeneratedSecret(
	state: DokployStageState | null,
	appName: string,
	secretName: string,
): string | undefined {
	return state?.generatedSecrets?.[appName]?.[secretName];
}

/**
 * Set a generated secret for an app (mutates state)
 */
export function setGeneratedSecret(
	state: DokployStageState,
	appName: string,
	secretName: string,
	value: string,
): void {
	if (!state.generatedSecrets) {
		state.generatedSecrets = {};
	}
	if (!state.generatedSecrets[appName]) {
		state.generatedSecrets[appName] = {};
	}
	state.generatedSecrets[appName][secretName] = value;
}

/**
 * Get all generated secrets for an app
 */
export function getAppGeneratedSecrets(
	state: DokployStageState | null,
	appName: string,
): Record<string, string> {
	return state?.generatedSecrets?.[appName] ?? {};
}

/**
 * Get all generated secrets from state
 */
export function getAllGeneratedSecrets(
	state: DokployStageState | null,
): Record<string, Record<string, string>> {
	return state?.generatedSecrets ?? {};
}

// ============================================================================
// DNS Verification
// ============================================================================

/**
 * Get DNS verification record for a hostname
 */
export function getDnsVerification(
	state: DokployStageState | null,
	hostname: string,
): DnsVerificationRecord | undefined {
	return state?.dnsVerified?.[hostname];
}

/**
 * Set DNS verification record for a hostname (mutates state)
 */
export function setDnsVerification(
	state: DokployStageState,
	hostname: string,
	serverIp: string,
): void {
	if (!state.dnsVerified) {
		state.dnsVerified = {};
	}
	state.dnsVerified[hostname] = {
		serverIp,
		verifiedAt: new Date().toISOString(),
	};
}

/**
 * Check if a hostname is already verified with the given IP
 */
export function isDnsVerified(
	state: DokployStageState | null,
	hostname: string,
	serverIp: string,
): boolean {
	const record = state?.dnsVerified?.[hostname];
	return record?.serverIp === serverIp;
}

/**
 * Get all DNS verification records from state
 */
export function getAllDnsVerifications(
	state: DokployStageState | null,
): Record<string, DnsVerificationRecord> {
	return state?.dnsVerified ?? {};
}

// ============================================================================
// DNS Records
// ============================================================================

/**
 * Get the key for a DNS record in state
 */
function getDnsRecordKey(name: string, type: string): string {
	return `${name}:${type}`;
}

/**
 * Get a created DNS record from state
 */
export function getDnsRecord(
	state: DokployStageState | null,
	name: string,
	type: string,
): CreatedDnsRecord | undefined {
	return state?.dnsRecords?.[getDnsRecordKey(name, type)];
}

/**
 * Set a created DNS record in state (mutates state)
 */
export function setDnsRecord(
	state: DokployStageState,
	record: Omit<CreatedDnsRecord, 'createdAt'>,
): void {
	if (!state.dnsRecords) {
		state.dnsRecords = {};
	}
	const key = getDnsRecordKey(record.name, record.type);
	state.dnsRecords[key] = {
		...record,
		createdAt: new Date().toISOString(),
	};
}

/**
 * Remove a DNS record from state (mutates state)
 */
export function removeDnsRecord(
	state: DokployStageState,
	name: string,
	type: string,
): void {
	if (state.dnsRecords) {
		delete state.dnsRecords[getDnsRecordKey(name, type)];
	}
}

/**
 * Get all created DNS records from state
 */
export function getAllDnsRecords(
	state: DokployStageState | null,
): CreatedDnsRecord[] {
	if (!state?.dnsRecords) {
		return [];
	}
	return Object.values(state.dnsRecords);
}

/**
 * Clear all DNS records from state (mutates state)
 */
export function clearDnsRecords(state: DokployStageState): void {
	state.dnsRecords = {};
	state.dnsVerified = {};
}

// ============================================================================
// Backup State
// ============================================================================

/**
 * Get backup state from state
 */
export function getBackupState(
	state: DokployStageState | null,
): BackupState | undefined {
	return state?.backups;
}

/**
 * Set backup state (mutates state)
 */
export function setBackupState(
	state: DokployStageState,
	backupState: BackupState,
): void {
	state.backups = backupState;
}

/**
 * Get backup destination ID from state
 */
export function getBackupDestinationId(
	state: DokployStageState | null,
): string | undefined {
	return state?.backups?.destinationId;
}

/**
 * Get postgres backup ID from state
 */
export function getPostgresBackupId(
	state: DokployStageState | null,
): string | undefined {
	return state?.backups?.postgresBackupId;
}

/**
 * Set postgres backup ID in state (mutates state)
 */
export function setPostgresBackupId(
	state: DokployStageState,
	backupId: string,
): void {
	if (state.backups) {
		state.backups.postgresBackupId = backupId;
	}
}
