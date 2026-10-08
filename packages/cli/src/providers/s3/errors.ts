/** What the `s3` provider refuses, and how each is put right. */

/** An `objects` entry for `s3` with a field it does not take or cannot use. */
export class S3ProviderConfigInvalid extends Error {
	constructor(
		readonly stage: string,
		readonly field: string,
		readonly value: unknown,
		readonly expected: string,
	) {
		super(
			`deploy.objects.${stage}.${field} is ${JSON.stringify(value)}; ${expected}.`,
		);
		this.name = 'S3ProviderConfigInvalid';
	}
}

/** No region anywhere to create the stage's buckets in. */
export class S3RegionRequired extends Error {
	constructor(readonly stage: string) {
		super(
			`The s3 provider has no region for the stage '${stage}'. Name one in ` +
				`gkm.config.ts: deploy: { objects: { ${stage}: { provider: 's3', ` +
				"region: 'eu-west-1' } } } — or set AWS_REGION.",
		);
		this.name = 'S3RegionRequired';
	}
}

/** The good name and every suffixed one are taken by other accounts. */
export class BucketNameUnavailable extends Error {
	constructor(
		readonly id: string,
		readonly tried: readonly string[],
	) {
		super(
			`Every name tried for the bucket '${id}' is taken by another AWS ` +
				`account: ${tried.join(', ')}. Set deploy.namespace in gkm.config.ts ` +
				'to something more particular to you, and run the provision again.',
		);
		this.name = 'BucketNameUnavailable';
	}
}

/** A bucket in this account carries another project's tag. */
export class BucketOwnedByAnotherProject extends Error {
	constructor(
		readonly bucket: string,
		readonly owner: string,
		readonly project: string,
	) {
		super(
			`The bucket '${bucket}' is in this account and tagged gkm:project=` +
				`${owner}, not ${project}: another project's. gkm never adopts it. ` +
				'Set deploy.namespace in gkm.config.ts so this project names its ' +
				'buckets differently.',
		);
		this.name = 'BucketOwnedByAnotherProject';
	}
}

/** The bucket the stage's state names exists, and this account cannot reach it. */
export class RecordedBucketUnreachable extends Error {
	constructor(
		readonly id: string,
		readonly bucket: string,
	) {
		super(
			`The stage's state records '${bucket}' as the bucket for '${id}', and ` +
				'this account cannot reach it — it is in another account, or the ' +
				"credentials are not the stage account's. Run with the account that " +
				'created it (--profile).',
		);
		this.name = 'RecordedBucketUnreachable';
	}
}

/** An IAM user by gkm's name exists, and gkm did not create it for this stage. */
export class IamUserNotOwned extends Error {
	constructor(
		readonly user: string,
		readonly project: string,
		readonly stage: string,
	) {
		super(
			`The IAM user '${user}' exists and is not tagged gkm:project=${project}, ` +
				`gkm:stage=${stage}, so gkm leaves it alone. Rename or delete it, or ` +
				'set deploy.namespace in gkm.config.ts so gkm names its users differently.',
		);
		this.name = 'IamUserNotOwned';
	}
}

/** The user already has the two access keys IAM allows. */
export class AccessKeyLimit extends Error {
	constructor(
		readonly user: string,
		readonly keys: readonly string[],
	) {
		super(
			`The IAM user '${user}' already has two access keys (${keys.join(', ')}), ` +
				'the most IAM allows, and gkm needs to issue one. Delete the one the ' +
				`stage does not use (aws iam delete-access-key --user-name ${user} ` +
				'--access-key-id …), then run the provision again.',
		);
		this.name = 'AccessKeyLimit';
	}
}

/** `--rotate-keys` while the last rotation's old key is still active. */
export class RotationInProgress extends Error {
	constructor(
		readonly id: string,
		readonly previous: string,
		readonly stage: string,
	) {
		super(
			`The bucket '${id}' is mid-rotation: its old key ${previous} is still ` +
				`active. Deploy '${stage}', then run gkm setup --stage ${stage} — ` +
				'or pass --retire-old-keys to delete it now — before rotating again.',
		);
		this.name = 'RotationInProgress';
	}
}

/** The stage's secrets point the bucket's key at a bucket gkm did not provision. */
export class BucketKeySetElsewhere extends Error {
	constructor(
		readonly key: string,
		readonly bucket: string,
		readonly found: string,
		readonly stage: string,
	) {
		super(
			`${key} in the stage '${stage}' points at the bucket '${found}', and ` +
				`the s3 provider manages '${bucket}' for it. Remove the key ` +
				`(gkm secrets:unset ${key} --stage ${stage}) to have the provider ` +
				`write its own, or set deploy.objects.${stage} to 'external' to keep yours.`,
		);
		this.name = 'BucketKeySetElsewhere';
	}
}

/** `verify()`: a provisioned bucket the stage's key cannot reach. */
export class ProvisionedBucketUnreachable extends Error {
	constructor(
		readonly id: string,
		readonly bucket: string,
		readonly stage: string,
		readonly reason: string,
	) {
		super(
			`The bucket '${bucket}' (${id}) cannot be reached with the key in the ` +
				`stage '${stage}''s secrets: ${reason}. Run gkm setup --stage ${stage} ` +
				"with the stage account's credentials to create or repair it, then deploy again.",
		);
		this.name = 'ProvisionedBucketUnreachable';
	}
}
