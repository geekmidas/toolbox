import { kebabCase, scopedName } from '@geekmidas/manifest';

/**
 * Kebab-cases an identifier: `userName` → `user-name`, `my_handler` →
 * `my-handler`, acronym-aware (`APIKey` → `api-key`) and digit-aware
 * (`S3Bucket` → `s3-bucket`).
 *
 * Re-exported from `@geekmidas/manifest` rather than implemented here. It used
 * to be implemented here, beside a second spelling of the same rule in the
 * manifest — which agreed on every id anyone had tried and disagreed on
 * `S3Bucket`.
 */
export const kebab = kebabCase;

/**
 * A kebab-cased, prefixed physical resource name — `[stage, app]` and the
 * resource, joined and lower-cased, without doubling a prefix the resource
 * already carries.
 *
 * The same rule every other target names by: this is `cloudName` for a caller
 * whose prefix is a list, because an SST stack contributes a segment of its
 * own. A construct is named the same thing here and on Dokploy, which is the
 * property that lets one name be read across providers.
 */
export const prefixedName = scopedName;

/**
 * The region out of an AWS ARN — `arn:aws:sqs:eu-west-1:123:emails` →
 * `eu-west-1`.
 *
 * Every connection string this package composes carries the region explicitly,
 * because `AWS_REGION` inside a Lambda is the *function's* region and not the
 * resource's. A cross-region queue then works right up until it doesn't, and
 * fails at runtime with nothing in the URL to explain why.
 *
 * Returns `undefined` for the ARN shapes that carry no region — an IAM ARN, or
 * anything that is not an ARN at all — so a caller omits the parameter rather
 * than writing an empty one.
 */
export function regionOfArn(arn: string): string | undefined {
	const [prefix, , , region] = arn.split(':');

	return prefix === 'arn' && region ? region : undefined;
}
