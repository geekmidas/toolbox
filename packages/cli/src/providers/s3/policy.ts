/**
 * The documents the `s3` provider writes: the user's inline policy, the
 * bucket's policy, its CORS rule and its public access block.
 *
 * Pure, so each is tested as JSON and compared with what AWS holds on every
 * run — a document that differs is drift, and is put back.
 */

/** One IAM or bucket policy statement. */
export interface PolicyStatement {
	Sid: string;
	Effect: 'Allow' | 'Deny';
	Principal?: '*' | { AWS: string | string[] };
	Action: string | string[];
	Resource: string | string[];
	Condition?: Record<string, Record<string, string>>;
}

export interface PolicyDocument {
	Version: '2012-10-17';
	Statement: PolicyStatement[];
}

const bucketArn = (bucket: string) => `arn:aws:s3:::${bucket}`;

/**
 * What the app's key may do: objects in this bucket, and listing it — and
 * nothing else in the account.
 *
 * Multipart uploads are in it because a presigned upload of a large file is
 * one, and an abandoned one is cleaned up by the app. Reading old versions is
 * added only when the bucket keeps them.
 */
export function userPolicy(
	bucket: string,
	options: { versioning?: boolean } = {},
): PolicyDocument {
	return {
		Version: '2012-10-17',
		Statement: [
			{
				Sid: 'GkmObjects',
				Effect: 'Allow',
				Action: [
					's3:GetObject',
					's3:PutObject',
					's3:DeleteObject',
					's3:AbortMultipartUpload',
					's3:ListMultipartUploadParts',
					...(options.versioning ? ['s3:GetObjectVersion'] : []),
				],
				Resource: `${bucketArn(bucket)}/*`,
			},
			{
				Sid: 'GkmBucket',
				Effect: 'Allow',
				Action: [
					's3:ListBucket',
					's3:GetBucketLocation',
					's3:ListBucketMultipartUploads',
				],
				Resource: bucketArn(bucket),
			},
		],
	};
}

/**
 * One open pattern as the resource it is public on. A `**` is S3's `*`; a
 * single `*` is too, which crosses `/` where the construct's own check does
 * not — the construct is the stricter of the two (see `bucketPolicy` in
 * reconcile, which the local MinIO is given the same way).
 */
export function openResource(bucket: string, pattern: string): string {
	const path = pattern.replace(/^\/+/, '').replace(/\*\*/g, '*');
	return `${bucketArn(bucket)}/${path}`;
}

/**
 * The bucket's own policy: every request refused unless it came over TLS,
 * and — only when a file server opens paths on it — anonymous `s3:GetObject`
 * on exactly those prefixes.
 */
export function bucketPolicy(
	bucket: string,
	open: readonly string[] = [],
): PolicyDocument {
	const statements: PolicyStatement[] = [
		{
			Sid: 'GkmDenyInsecureTransport',
			Effect: 'Deny',
			Principal: '*',
			Action: 's3:*',
			Resource: [bucketArn(bucket), `${bucketArn(bucket)}/*`],
			Condition: { Bool: { 'aws:SecureTransport': 'false' } },
		},
	];
	if (open.length > 0) {
		statements.push({
			Sid: 'GkmOpenPaths',
			Effect: 'Allow',
			Principal: '*',
			Action: 's3:GetObject',
			Resource: [...new Set(open.map((p) => openResource(bucket, p)))].sort(),
		});
	}
	return { Version: '2012-10-17', Statement: statements };
}

/**
 * Block Public Access. All four flags on, unless the bucket has open paths:
 * then a *policy* may make it public (`BlockPublicPolicy`,
 * `RestrictPublicBuckets` off), and ACLs still may not.
 */
export function publicAccessBlock(open: boolean): {
	BlockPublicAcls: boolean;
	IgnorePublicAcls: boolean;
	BlockPublicPolicy: boolean;
	RestrictPublicBuckets: boolean;
} {
	return {
		BlockPublicAcls: true,
		IgnorePublicAcls: true,
		BlockPublicPolicy: !open,
		RestrictPublicBuckets: !open,
	};
}

/** The one CORS rule: browsers on the stage's sites upload and read. */
export interface CorsRule {
	AllowedMethods: string[];
	AllowedOrigins: string[];
	AllowedHeaders: string[];
	ExposeHeaders: string[];
	MaxAgeSeconds: number;
}

export function corsRule(origins: readonly string[]): CorsRule {
	return {
		AllowedMethods: ['GET', 'HEAD', 'POST', 'PUT'],
		AllowedOrigins: [...new Set(origins)].sort(),
		AllowedHeaders: ['*'],
		ExposeHeaders: ['ETag'],
		MaxAgeSeconds: 3000,
	};
}

/**
 * A policy document in one canonical form — keys sorted, a lone string a
 * one-element list, lists sorted — so one AWS reformatted reads as the same
 * document rather than as drift.
 */
export function canonicalPolicy(value: unknown): string {
	return JSON.stringify(canonical(value));
}

function canonical(value: unknown, key?: string): unknown {
	if (Array.isArray(value)) {
		const items = value.map((v) => canonical(v));
		return key === 'Statement'
			? items
			: items.map((v) => JSON.stringify(v)).sort();
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((k) => {
					const v = (value as Record<string, unknown>)[k];
					const listy =
						k === 'Action' || k === 'Resource' || k === 'AWS'
							? Array.isArray(v)
								? v
								: [v]
							: v;
					return [k, canonical(listy, k)];
				}),
		);
	}
	return value;
}
