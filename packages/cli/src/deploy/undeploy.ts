/**
 * Undeploy - Remove deployed resources from Dokploy
 *
 * Deletes applications, services (postgres, redis), DNS records, and optionally the project.
 * Also handles cleanup of backup resources if configured.
 */

import type { DnsProvider } from './dns/DnsProvider.js';
import type { DokployApi } from './dokploy-api.js';
import type { BackupState, DokployStageState } from './state.js';
import { getAllDnsRecords } from './state.js';

export interface UndeployOptions {
	/** Dokploy API client */
	api: DokployApi;
	/** Deploy state for the stage */
	state: DokployStageState;
	/** DNS provider for deleting DNS records (optional) */
	dnsProvider?: DnsProvider;
	/** Whether to delete the Dokploy project (default: false) */
	deleteProject?: boolean;
	/** Whether to delete backup resources (S3 bucket, IAM user) - default: false */
	deleteBackups?: boolean;
	/** AWS endpoint override (for testing with LocalStack) */
	awsEndpoint?: string;
	/** Logger for progress output */
	logger: { log: (msg: string) => void };
}

export interface UndeployResult {
	/** Applications that were deleted */
	deletedApplications: string[];
	/** Whether postgres was deleted */
	deletedPostgres: boolean;
	/** Whether redis was deleted */
	deletedRedis: boolean;
	/** Whether the project was deleted */
	deletedProject: boolean;
	/** Whether backup destination was deleted */
	deletedBackupDestination: boolean;
	/** Whether AWS backup resources were deleted */
	deletedAwsBackupResources: boolean;
	/** DNS records that were deleted (name:type format) */
	deletedDnsRecords: string[];
	/** Updated state after undeploy (with deleted resources removed) */
	updatedState: DokployStageState;
	/** Errors encountered during undeploy (non-fatal) */
	errors: string[];
}

/**
 * Undeploy resources from Dokploy
 *
 * Executes in order:
 * 1. Run final backup (if backup is configured)
 * 2. Delete DNS records (if DNS provider is available)
 * 3. Delete backup schedules
 * 4. Delete applications
 * 5. Delete postgres database
 * 6. Delete redis instance
 * 7. Delete backup destination
 * 8. Delete AWS backup resources (if deleteBackups is true)
 * 9. Delete project (if deleteProject is true)
 *
 * Returns the updated state with deleted resources removed.
 */
export async function undeploy(
	options: UndeployOptions,
): Promise<UndeployResult> {
	const {
		api,
		state,
		dnsProvider,
		deleteProject = false,
		deleteBackups = false,
		awsEndpoint,
		logger,
	} = options;

	// Create a mutable copy of the state to track deletions
	const updatedState: DokployStageState = JSON.parse(JSON.stringify(state));

	const result: UndeployResult = {
		deletedApplications: [],
		deletedPostgres: false,
		deletedRedis: false,
		deletedProject: false,
		deletedBackupDestination: false,
		deletedAwsBackupResources: false,
		deletedDnsRecords: [],
		updatedState,
		errors: [],
	};

	// 1. Run a final backup before undeploying (if backup is configured)
	if (state.backups?.postgresBackupId) {
		try {
			logger.log('   Running final postgres backup before undeploy...');
			await api.runBackupManually(state.backups.postgresBackupId);
			logger.log('   ✓ Final backup triggered');
		} catch (error) {
			const msg = `Failed to run final backup: ${error}`;
			logger.log(`   ⚠ ${msg}`);
			result.errors.push(msg);
		}
	}

	// 2. Delete DNS records (if DNS provider is available)
	if (dnsProvider) {
		const dnsRecords = getAllDnsRecords(state);
		if (dnsRecords.length > 0) {
			// Group records by domain
			const recordsByDomain = new Map<
				string,
				Array<{ name: string; type: string }>
			>();
			for (const record of dnsRecords) {
				const existing = recordsByDomain.get(record.domain) ?? [];
				existing.push({ name: record.name, type: record.type });
				recordsByDomain.set(record.domain, existing);
			}

			for (const [domain, records] of recordsByDomain) {
				try {
					logger.log(
						`   Deleting ${records.length} DNS record(s) for ${domain}...`,
					);
					const deleteResults = await dnsProvider.deleteRecords(
						domain,
						records.map((r) => ({
							name: r.name,
							type: r.type as
								| 'A'
								| 'AAAA'
								| 'CNAME'
								| 'MX'
								| 'TXT'
								| 'SRV'
								| 'CAA',
						})),
					);

					for (const deleteResult of deleteResults) {
						const key = `${deleteResult.record.name}:${deleteResult.record.type}`;
						if (deleteResult.deleted || deleteResult.notFound) {
							result.deletedDnsRecords.push(key);
							// Remove from state
							if (updatedState.dnsRecords) {
								delete updatedState.dnsRecords[key];
							}
							if (updatedState.dnsVerified) {
								// Find and remove hostname from dnsVerified
								const hostname =
									deleteResult.record.name === '@'
										? domain
										: `${deleteResult.record.name}.${domain}`;
								delete updatedState.dnsVerified[hostname];
							}
							logger.log(`   ✓ DNS record ${key} deleted`);
						} else if (deleteResult.error) {
							const msg = `Failed to delete DNS record ${key}: ${deleteResult.error}`;
							logger.log(`   ⚠ ${msg}`);
							result.errors.push(msg);
						}
					}
				} catch (error) {
					const msg = `Failed to delete DNS records for ${domain}: ${error}`;
					logger.log(`   ⚠ ${msg}`);
					result.errors.push(msg);
				}
			}
		}
	}

	// 3. Delete backup schedules (before deleting postgres)
	if (state.backups?.postgresBackupId) {
		try {
			logger.log('   Deleting postgres backup schedule...');
			await api.deleteBackup(state.backups.postgresBackupId);
			if (updatedState.backups) {
				delete updatedState.backups.postgresBackupId;
			}
			logger.log('   ✓ Backup schedule deleted');
		} catch (error) {
			const msg = `Failed to delete backup schedule: ${error}`;
			logger.log(`   ⚠ ${msg}`);
			result.errors.push(msg);
		}
	}

	// 4. Delete all applications
	for (const [appName, applicationId] of Object.entries(state.applications)) {
		try {
			logger.log(`   Deleting application: ${appName}...`);
			await api.deleteApplication(applicationId);
			result.deletedApplications.push(appName);
			delete updatedState.applications[appName];
			// Also remove app credentials and generated secrets
			if (updatedState.appCredentials) {
				delete updatedState.appCredentials[appName];
			}
			if (updatedState.generatedSecrets) {
				delete updatedState.generatedSecrets[appName];
			}
			logger.log(`   ✓ Application ${appName} deleted`);
		} catch (error) {
			const msg = `Failed to delete application ${appName}: ${error}`;
			logger.log(`   ⚠ ${msg}`);
			result.errors.push(msg);
		}
	}

	// 5. Delete postgres if exists
	if (state.services.postgresId) {
		try {
			logger.log('   Deleting postgres database...');
			await api.deletePostgres(state.services.postgresId);
			result.deletedPostgres = true;
			delete updatedState.services.postgresId;
			logger.log('   ✓ Postgres deleted');
		} catch (error) {
			const msg = `Failed to delete postgres: ${error}`;
			logger.log(`   ⚠ ${msg}`);
			result.errors.push(msg);
		}
	}

	// 6. Delete redis if exists
	if (state.services.redisId) {
		try {
			logger.log('   Deleting redis instance...');
			await api.deleteRedis(state.services.redisId);
			result.deletedRedis = true;
			delete updatedState.services.redisId;
			logger.log('   ✓ Redis deleted');
		} catch (error) {
			const msg = `Failed to delete redis: ${error}`;
			logger.log(`   ⚠ ${msg}`);
			result.errors.push(msg);
		}
	}

	// 7. Delete backup destination from Dokploy
	if (state.backups?.destinationId) {
		try {
			logger.log('   Deleting backup destination...');
			await api.deleteDestination(state.backups.destinationId);
			result.deletedBackupDestination = true;
			logger.log('   ✓ Backup destination deleted');
		} catch (error) {
			const msg = `Failed to delete backup destination: ${error}`;
			logger.log(`   ⚠ ${msg}`);
			result.errors.push(msg);
		}
	}

	// 8. Delete AWS backup resources if requested
	if (deleteBackups && state.backups) {
		try {
			logger.log('   Deleting AWS backup resources...');
			await deleteAwsBackupResources(state.backups, awsEndpoint, logger);
			result.deletedAwsBackupResources = true;
			// Clear backup state entirely
			delete updatedState.backups;
			logger.log('   ✓ AWS backup resources deleted');
		} catch (error) {
			const msg = `Failed to delete AWS backup resources: ${error}`;
			logger.log(`   ⚠ ${msg}`);
			result.errors.push(msg);
		}
	}

	// 9. Delete project if requested
	if (deleteProject) {
		try {
			logger.log('   Deleting Dokploy project...');
			await api.deleteProject(state.projectId);
			result.deletedProject = true;
			logger.log('   ✓ Project deleted');
		} catch (error) {
			const msg = `Failed to delete project: ${error}`;
			logger.log(`   ⚠ ${msg}`);
			result.errors.push(msg);
		}
	}

	return result;
}

/**
 * Delete AWS backup resources (S3 bucket, IAM user)
 */
async function deleteAwsBackupResources(
	backupState: BackupState,
	awsEndpoint?: string,
	logger?: { log: (msg: string) => void },
): Promise<void> {
	const {
		S3Client,
		DeleteBucketCommand,
		DeleteObjectsCommand,
		ListObjectsV2Command,
	} = await import('@aws-sdk/client-s3');

	const {
		IAMClient,
		DeleteAccessKeyCommand,
		DeleteUserCommand,
		DeleteUserPolicyCommand,
		ListAccessKeysCommand,
	} = await import('@aws-sdk/client-iam');

	const clientConfig: {
		region: string;
		endpoint?: string;
		forcePathStyle?: boolean;
		credentials?: { accessKeyId: string; secretAccessKey: string };
	} = {
		region: backupState.region,
	};

	if (awsEndpoint) {
		clientConfig.endpoint = awsEndpoint;
		clientConfig.forcePathStyle = true;
		clientConfig.credentials = {
			accessKeyId: 'test',
			secretAccessKey: 'test',
		};
	}

	const s3 = new S3Client(clientConfig);
	const iam = new IAMClient(clientConfig);

	try {
		// Delete all objects in the bucket first
		logger?.log(`      Emptying bucket: ${backupState.bucketName}`);
		let continuationToken: string | undefined;
		do {
			const listResult = await s3.send(
				new ListObjectsV2Command({
					Bucket: backupState.bucketName,
					ContinuationToken: continuationToken,
				}),
			);

			if (listResult.Contents?.length) {
				await s3.send(
					new DeleteObjectsCommand({
						Bucket: backupState.bucketName,
						Delete: {
							Objects: listResult.Contents.map((o) => ({ Key: o.Key })),
						},
					}),
				);
			}

			continuationToken = listResult.NextContinuationToken;
		} while (continuationToken);

		// Delete the bucket
		logger?.log(`      Deleting bucket: ${backupState.bucketName}`);
		await s3.send(new DeleteBucketCommand({ Bucket: backupState.bucketName }));
	} catch (error) {
		// Bucket might not exist, continue with IAM cleanup
		logger?.log(`      Warning: Could not delete bucket: ${error}`);
	}

	try {
		// Delete all access keys for the IAM user
		logger?.log(
			`      Deleting IAM access keys for: ${backupState.iamUserName}`,
		);
		const keysResult = await iam.send(
			new ListAccessKeysCommand({ UserName: backupState.iamUserName }),
		);

		for (const key of keysResult.AccessKeyMetadata ?? []) {
			await iam.send(
				new DeleteAccessKeyCommand({
					UserName: backupState.iamUserName,
					AccessKeyId: key.AccessKeyId,
				}),
			);
		}

		// Delete the user policy
		logger?.log(`      Deleting IAM policy for: ${backupState.iamUserName}`);
		await iam.send(
			new DeleteUserPolicyCommand({
				UserName: backupState.iamUserName,
				PolicyName: 'DokployBackupAccess',
			}),
		);

		// Delete the IAM user
		logger?.log(`      Deleting IAM user: ${backupState.iamUserName}`);
		await iam.send(
			new DeleteUserCommand({ UserName: backupState.iamUserName }),
		);
	} catch (error) {
		// IAM user might not exist
		logger?.log(`      Warning: Could not delete IAM user: ${error}`);
	}

	s3.destroy();
	iam.destroy();
}
