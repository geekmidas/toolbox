import { encryptSecrets } from '../secrets/encryption.js';
import { toEmbeddableSecrets } from '../secrets/storage.js';
import type {
	EmbeddableSecrets,
	EncryptedPayload,
	StageSecrets,
} from '../secrets/types.js';
import type { SniffedEnvironment } from './sniffer.js';

/**
 * Result of filtering secrets for an app.
 */
export interface FilteredAppSecrets {
	appName: string;
	/** Secrets filtered to only include what the app needs */
	secrets: EmbeddableSecrets;
	/** List of required env vars that were found in secrets */
	found: string[];
	/** List of required env vars that were NOT found in secrets */
	missing: string[];
}

/**
 * Filter secrets to only include the env vars that an app requires.
 *
 * @param stageSecrets - All secrets for the stage
 * @param sniffedEnv - The sniffed environment requirements for the app
 * @returns Filtered secrets with found/missing tracking
 */
export function filterSecretsForApp(
	stageSecrets: StageSecrets,
	sniffedEnv: SniffedEnvironment,
): FilteredAppSecrets {
	// Convert stage secrets to flat embeddable format
	const allSecrets = toEmbeddableSecrets(stageSecrets);
	const filtered: EmbeddableSecrets = {};
	const found: string[] = [];
	const missing: string[] = [];

	// Filter to only required env vars
	for (const key of sniffedEnv.requiredEnvVars) {
		if (key in allSecrets) {
			filtered[key] = allSecrets[key]!;
			found.push(key);
		} else {
			missing.push(key);
		}
	}

	return {
		appName: sniffedEnv.appName,
		secrets: filtered,
		found: found.sort(),
		missing: missing.sort(),
	};
}

/**
 * Result of encrypting secrets for an app.
 */
export interface EncryptedAppSecrets {
	appName: string;
	/** Encrypted payload with credentials and IV */
	payload: EncryptedPayload;
	/** Master key for runtime decryption (hex encoded) */
	masterKey: string;
	/** Number of secrets encrypted */
	secretCount: number;
	/** List of required env vars that were NOT found in secrets */
	missingSecrets: string[];
}

/**
 * Encrypt filtered secrets for an app.
 * Generates an ephemeral master key that should be injected into Dokploy.
 *
 * @param filteredSecrets - The filtered secrets for the app
 * @returns Encrypted payload with master key
 */
export function encryptSecretsForApp(
	filteredSecrets: FilteredAppSecrets,
): EncryptedAppSecrets {
	const payload = encryptSecrets(filteredSecrets.secrets);

	return {
		appName: filteredSecrets.appName,
		payload,
		masterKey: payload.masterKey,
		secretCount: Object.keys(filteredSecrets.secrets).length,
		missingSecrets: filteredSecrets.missing,
	};
}

/**
 * Filter and encrypt secrets for an app in one step.
 *
 * @param stageSecrets - All secrets for the stage
 * @param sniffedEnv - The sniffed environment requirements for the app
 * @returns Encrypted secrets with master key
 */
export function prepareSecretsForApp(
	stageSecrets: StageSecrets,
	sniffedEnv: SniffedEnvironment,
): EncryptedAppSecrets {
	const filtered = filterSecretsForApp(stageSecrets, sniffedEnv);
	return encryptSecretsForApp(filtered);
}

/**
 * Prepare secrets for multiple apps.
 *
 * @param stageSecrets - All secrets for the stage
 * @param sniffedApps - Map of app name to sniffed environment
 * @returns Map of app name to encrypted secrets
 */
export function prepareSecretsForAllApps(
	stageSecrets: StageSecrets,
	sniffedApps: Map<string, SniffedEnvironment>,
): Map<string, EncryptedAppSecrets> {
	const results = new Map<string, EncryptedAppSecrets>();

	for (const [appName, sniffedEnv] of sniffedApps) {
		// Only prepare secrets for apps that have required env vars
		if (sniffedEnv.requiredEnvVars.length > 0) {
			const encrypted = prepareSecretsForApp(stageSecrets, sniffedEnv);
			results.set(appName, encrypted);
		}
	}

	return results;
}

/**
 * Report on secrets preparation status for all apps.
 */
export interface SecretsReport {
	/** Total number of apps processed */
	totalApps: number;
	/** Apps with encrypted secrets */
	appsWithSecrets: string[];
	/** Apps without secrets (frontends or no env requirements) */
	appsWithoutSecrets: string[];
	/** Apps with missing secrets (warnings) */
	appsWithMissingSecrets: Array<{
		appName: string;
		missing: string[];
	}>;
}

/**
 * Generate a report on secrets preparation.
 */
export function generateSecretsReport(
	encryptedApps: Map<string, EncryptedAppSecrets>,
	sniffedApps: Map<string, SniffedEnvironment>,
): SecretsReport {
	const appsWithSecrets: string[] = [];
	const appsWithoutSecrets: string[] = [];
	const appsWithMissingSecrets: Array<{ appName: string; missing: string[] }> =
		[];

	for (const [appName, sniffedEnv] of sniffedApps) {
		if (sniffedEnv.requiredEnvVars.length === 0) {
			appsWithoutSecrets.push(appName);
			continue;
		}

		const encrypted = encryptedApps.get(appName);
		if (encrypted) {
			appsWithSecrets.push(appName);

			if (encrypted.missingSecrets.length > 0) {
				appsWithMissingSecrets.push({
					appName,
					missing: encrypted.missingSecrets,
				});
			}
		}
	}

	return {
		totalApps: sniffedApps.size,
		appsWithSecrets: appsWithSecrets.sort(),
		appsWithoutSecrets: appsWithoutSecrets.sort(),
		appsWithMissingSecrets,
	};
}
