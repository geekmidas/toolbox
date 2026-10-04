/**
 * The `kms://` URL an `Encryption` construct reads on AWS.
 *
 * Here because two packages meet on it: `@geekmidas/cloud` composes it from
 * the keys it provisioned, and `@geekmidas/constructs` parses it to reach
 * them. One function, so the two cannot disagree about a parameter's name.
 */

export const KMS_SCHEME = 'kms:';

/** `kms://<region>?key=<key arn>&index=<hmac key arn>` */
export function kmsUrl(input: {
	region: string;
	key: string;
	index: string;
}): string {
	const query = new URLSearchParams({ key: input.key, index: input.index });
	return `${KMS_SCHEME}//${input.region}?${query}`;
}
