/**
 * Where a bucket the `s3` provider is to create signs its links, before it
 * has: the origin of the name and region its first deploy gives it.
 *
 * A site's image inlines its buckets' signed origins, and a protected stage's
 * images are built on every push to the default branch, long before the
 * release that first deploys the stage. The connection the origin is
 * otherwise derived from (`signedOrigins`) is written by that deploy, so
 * without this a stage that has never been deployed cannot be built, and a
 * stage that cannot be built is never deployed.
 */

import * as s3Url from '@geekmidas/storage/s3-url';
import { appKey } from '../../workspace/derive.js';
import type {
	NormalizedWorkspace,
	S3ObjectsConfig,
} from '../../workspace/types.js';
import { awsEndpoint } from '../aws.js';
import { s3Region } from './config.js';
import { bucketName } from './naming.js';

export interface PlannedOriginInput {
	workspace: Pick<NormalizedWorkspace, 'secrets'>;
	stage: string;
	/** The deploy identity's scope, which every bucket name starts with. */
	scope: string;
	config: S3ObjectsConfig;
	/** The `ObjectStorage` construct's id. */
	bucket: string;
}

/**
 * `https://<bucket>.s3.<region>.amazonaws.com` for the bucket's good name.
 *
 * Nothing when it cannot be known ahead: against an S3 emulator
 * (`AWS_ENDPOINT_URL`), or with no region to name. The first deploy names a
 * bucket otherwise only when another account already holds the good name —
 * a suffixed one, which it reports, and whose origin the next build inlines.
 */
export function plannedSignedOrigin(
	input: PlannedOriginInput,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	if (awsEndpoint(env, 'S3')) return undefined;
	let region: string;
	try {
		region = s3Region(input, env);
	} catch {
		return undefined;
	}
	const bucket = bucketName({
		scope: input.scope,
		stage: input.stage,
		id: appKey(input.bucket),
	});
	return s3Url.signedOrigin({ bucket, region });
}
