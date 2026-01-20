/**
 * Backup Destination Provisioner
 *
 * Creates AWS resources (S3 bucket, IAM user, access keys) and configures
 * Dokploy backup destinations for database backups.
 */

import {
	CreateAccessKeyCommand,
	CreateUserCommand,
	GetUserCommand,
	IAMClient,
	type IAMClientConfig,
	PutUserPolicyCommand,
} from '@aws-sdk/client-iam';
import {
	type BucketLocationConstraint,
	CreateBucketCommand,
	HeadBucketCommand,
	PutBucketVersioningCommand,
	S3Client,
	type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { BackupsConfig } from '../workspace/types.js';
import type { DokployApi } from './dokploy-api.js';
import type { BackupState } from './state.js';

export interface ProvisionBackupOptions {
	/** Dokploy API client */
	api: DokployApi;
	/** Dokploy project ID */
	projectId: string;
	/** Workspace name (used for resource naming) */
	projectName: string;
	/** Deploy stage (e.g., 'production', 'staging') */
	stage: string;
	/** Backup configuration */
	config: BackupsConfig;
	/** Existing backup state (if any) */
	existingState?: BackupState;
	/** Logger for progress output */
	logger: { log: (msg: string) => void };
	/** AWS endpoint override (for testing with LocalStack) */
	awsEndpoint?: string;
}

/**
 * Generate a random suffix for unique resource names
 */
function randomSuffix(): string {
	return Math.random().toString(36).substring(2, 8);
}

/**
 * Sanitize a name for AWS resources (lowercase alphanumeric and hyphens)
 */
function sanitizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Create AWS clients with optional profile credentials
 */
async function createAwsClients(
	region: string,
	profile?: string,
	endpoint?: string,
): Promise<{ s3: S3Client; iam: IAMClient }> {
	const config: S3ClientConfig & IAMClientConfig = { region };

	if (profile) {
		const { fromIni } = await import('@aws-sdk/credential-providers');
		config.credentials = fromIni({ profile });
	}

	// Support custom endpoint for testing (e.g., LocalStack)
	if (endpoint) {
		config.endpoint = endpoint;
		(config as S3ClientConfig).forcePathStyle = true;
		// Use test credentials when endpoint is specified
		config.credentials = {
			accessKeyId: 'test',
			secretAccessKey: 'test',
		};
	}

	return {
		s3: new S3Client(config),
		iam: new IAMClient(config),
	};
}

/**
 * Check if an S3 bucket exists
 */
async function bucketExists(
	s3: S3Client,
	bucketName: string,
): Promise<boolean> {
	try {
		await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
		return true;
	} catch (error) {
		if ((error as { name?: string }).name === 'NotFound') {
			return false;
		}
		// 403 means bucket exists but we don't have access
		if (
			(error as { $metadata?: { httpStatusCode?: number } }).$metadata
				?.httpStatusCode === 403
		) {
			return true;
		}
		throw error;
	}
}

/**
 * Check if an IAM user exists
 */
async function userExists(iam: IAMClient, userName: string): Promise<boolean> {
	try {
		await iam.send(new GetUserCommand({ UserName: userName }));
		return true;
	} catch (error) {
		const errorName = (error as { name?: string }).name;
		// AWS returns 'NoSuchEntity', LocalStack returns 'NoSuchEntityException'
		if (errorName === 'NoSuchEntity' || errorName === 'NoSuchEntityException') {
			return false;
		}
		throw error;
	}
}

/**
 * Provision backup destination for a deployment.
 *
 * Creates AWS resources (S3 bucket, IAM user) and Dokploy destination if needed.
 * Reuses existing resources from state when possible.
 */
export async function provisionBackupDestination(
	options: ProvisionBackupOptions,
): Promise<BackupState> {
	const { api, projectName, stage, config, existingState, logger, awsEndpoint } =
		options;

	// If we have existing state, verify the Dokploy destination still exists
	if (existingState?.destinationId) {
		try {
			await api.getDestination(existingState.destinationId);
			logger.log('   Using existing backup destination');
			return existingState;
		} catch {
			logger.log('   Existing destination not found, recreating...');
		}
	}

	// Create AWS clients
	const aws = await createAwsClients(config.region, config.profile, awsEndpoint);
	const sanitizedProject = sanitizeName(projectName);

	// 1. Create or verify S3 bucket
	const bucketName =
		existingState?.bucketName ??
		`${sanitizedProject}-${stage}-backups-${randomSuffix()}`;

	const bucketAlreadyExists = await bucketExists(aws.s3, bucketName);
	if (!bucketAlreadyExists) {
		logger.log(`   Creating S3 bucket: ${bucketName}`);

		// CreateBucket needs LocationConstraint for non-us-east-1 regions
		const createBucketParams: {
			Bucket: string;
			CreateBucketConfiguration?: {
				LocationConstraint: BucketLocationConstraint;
			};
		} = {
			Bucket: bucketName,
		};
		if (config.region !== 'us-east-1') {
			createBucketParams.CreateBucketConfiguration = {
				LocationConstraint: config.region as BucketLocationConstraint,
			};
		}

		await aws.s3.send(new CreateBucketCommand(createBucketParams));

		// Enable versioning for backup integrity
		await aws.s3.send(
			new PutBucketVersioningCommand({
				Bucket: bucketName,
				VersioningConfiguration: { Status: 'Enabled' },
			}),
		);
	} else {
		logger.log(`   Using existing S3 bucket: ${bucketName}`);
	}

	// 2. Create or verify IAM user
	const iamUserName =
		existingState?.iamUserName ?? `dokploy-backup-${sanitizedProject}-${stage}`;

	const iamUserAlreadyExists = await userExists(aws.iam, iamUserName);
	if (!iamUserAlreadyExists) {
		logger.log(`   Creating IAM user: ${iamUserName}`);
		await aws.iam.send(new CreateUserCommand({ UserName: iamUserName }));
	} else {
		logger.log(`   Using existing IAM user: ${iamUserName}`);
	}

	// 3. Attach bucket policy to IAM user
	const policyDocument = {
		Version: '2012-10-17',
		Statement: [
			{
				Effect: 'Allow',
				Action: [
					's3:GetObject',
					's3:PutObject',
					's3:DeleteObject',
					's3:ListBucket',
					's3:GetBucketLocation',
				],
				Resource: [
					`arn:aws:s3:::${bucketName}`,
					`arn:aws:s3:::${bucketName}/*`,
				],
			},
		],
	};

	logger.log('   Updating IAM policy');
	await aws.iam.send(
		new PutUserPolicyCommand({
			UserName: iamUserName,
			PolicyName: 'DokployBackupAccess',
			PolicyDocument: JSON.stringify(policyDocument),
		}),
	);

	// 4. Create access key (or reuse existing if state has it and destination needs recreation)
	let accessKeyId: string;
	let secretAccessKey: string;

	if (existingState?.iamAccessKeyId && existingState?.iamSecretAccessKey) {
		// Reuse existing credentials
		logger.log('   Using existing IAM access key');
		accessKeyId = existingState.iamAccessKeyId;
		secretAccessKey = existingState.iamSecretAccessKey;
	} else {
		// Create new access key
		logger.log('   Creating IAM access key');
		const accessKeyResult = await aws.iam.send(
			new CreateAccessKeyCommand({ UserName: iamUserName }),
		);

		if (!accessKeyResult.AccessKey) {
			throw new Error('Failed to create IAM access key');
		}

		accessKeyId = accessKeyResult.AccessKey.AccessKeyId!;
		secretAccessKey = accessKeyResult.AccessKey.SecretAccessKey!;
	}

	// 5. Create Dokploy destination
	const destinationName = `${sanitizedProject}-${stage}-s3`;
	logger.log(`   Creating Dokploy destination: ${destinationName}`);

	const { destination, created } = await api.findOrCreateDestination(
		destinationName,
		{
			accessKey: accessKeyId,
			secretAccessKey: secretAccessKey,
			bucket: bucketName,
			region: config.region,
		},
	);

	if (created) {
		logger.log('   ✓ Dokploy destination created');
	} else {
		logger.log('   ✓ Using existing Dokploy destination');
	}

	// 6. Test connection
	try {
		await api.testDestinationConnection(destination.destinationId);
		logger.log('   ✓ Destination connection verified');
	} catch (error) {
		logger.log(
			`   ⚠ Warning: Could not verify destination connection: ${error}`,
		);
	}

	return {
		bucketName,
		bucketArn: `arn:aws:s3:::${bucketName}`,
		iamUserName,
		iamAccessKeyId: accessKeyId,
		iamSecretAccessKey: secretAccessKey,
		destinationId: destination.destinationId,
		region: config.region,
		createdAt: existingState?.createdAt ?? new Date().toISOString(),
	};
}
