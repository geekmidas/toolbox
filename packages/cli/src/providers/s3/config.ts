/** `deploy.objects.<stage>` for the `s3` provider, checked. */

import type {
	NormalizedWorkspace,
	S3ObjectsConfig,
} from '../../workspace/types.js';
import type { ProviderConfig } from '../types.js';
import { S3ProviderConfigInvalid, S3RegionRequired } from './errors.js';

const FIELDS = ['provider', 'region', 'versioning', 'cdn'] as const;

/** An AWS region code: `eu-west-1`, `us-gov-west-1`, `ap-southeast-4`. */
const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;

export function checkS3Config(
	stage: string,
	config: ProviderConfig,
): S3ObjectsConfig {
	const entry = config as unknown as Record<string, unknown>;
	for (const field of Object.keys(entry)) {
		if (!(FIELDS as readonly string[]).includes(field)) {
			throw new S3ProviderConfigInvalid(
				stage,
				field,
				entry[field],
				`the s3 provider takes ${FIELDS.slice(1).join(', ')} only`,
			);
		}
	}
	if (entry.region !== undefined) {
		if (typeof entry.region !== 'string' || !REGION.test(entry.region)) {
			throw new S3ProviderConfigInvalid(
				stage,
				'region',
				entry.region,
				"set it to an AWS region code, like 'eu-west-1'",
			);
		}
	}
	if (entry.versioning !== undefined && typeof entry.versioning !== 'boolean') {
		throw new S3ProviderConfigInvalid(
			stage,
			'versioning',
			entry.versioning,
			'set it to true to keep previous versions of every object, or leave it out',
		);
	}
	if (entry.cdn !== undefined && typeof entry.cdn !== 'boolean') {
		throw new S3ProviderConfigInvalid(
			stage,
			'cdn',
			entry.cdn,
			"set it to false to serve file servers from the bucket's own endpoint, or leave it out",
		);
	}
	return entry as unknown as S3ObjectsConfig;
}

/**
 * Whether a stage's buckets on S3 serve their file servers behind a CDN, at
 * `fileServerHost` on the stage's domain — the default — rather than on the
 * bucket's own endpoint (`cdn: false`).
 */
export function servesOnCdn(config: Pick<S3ObjectsConfig, 'cdn'>): boolean {
	return config.cdn !== false;
}

/** How the s3 provider's provisioning credentials are supplied. */
export const S3_PROVISIONING = {
	env: [
		'AWS_PROFILE',
		'AWS_ACCESS_KEY_ID',
		'AWS_SECRET_ACCESS_KEY',
		'AWS_SESSION_TOKEN',
	],
	describe:
		"the stage's AWS account — AWS_PROFILE, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (in CI, what aws-actions/configure-aws-credentials exports)",
} as const;

/**
 * The region the stage's buckets are created in: the entry's, the secrets
 * store's when it is in AWS, the credential's, `AWS_REGION`.
 *
 * Here rather than beside the provider so a stage's stack can name it
 * without loading the AWS SDK.
 */
export function s3Region(
	ctx: {
		config: Pick<S3ObjectsConfig, 'region'>;
		workspace: Pick<NormalizedWorkspace, 'secrets'>;
		stage: string;
		credential?: { region?: string };
	},
	env: NodeJS.ProcessEnv = process.env,
): string {
	const store = ctx.workspace.secrets?.store;
	const storeRegion =
		store && typeof store === 'object' && 'region' in store
			? (store as { region?: string }).region
			: undefined;
	const region =
		ctx.config.region ??
		storeRegion ??
		ctx.credential?.region ??
		env.AWS_REGION ??
		env.AWS_DEFAULT_REGION;
	if (!region) throw new S3RegionRequired(ctx.stage);
	return region;
}
