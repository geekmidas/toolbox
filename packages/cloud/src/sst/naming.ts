/**
 * Kebab-cases an identifier: `userName` → `user-name`, `my_handler` →
 * `my-handler`, and acronym-aware (`APIKey` → `api-key`, `XMLParser` →
 * `xml-parser`).
 */
export function kebab(value: string): string {
	return value
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/[\s_]+/g, '-')
		.toLowerCase();
}

/**
 * Builds a kebab-cased, prefixed physical resource name. The `prefix` parts
 * (e.g. `[stage, name]`) are joined and lower-cased; if `resource` already
 * starts with that prefix it is returned as-is (kebab-cased) to avoid doubling.
 */
export function prefixedName(prefix: string[], resource: string): string {
	const joined = prefix.join('-').toLowerCase();
	const name = kebab(resource);
	return name.startsWith(joined) ? name : `${joined}-${name}`;
}

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
