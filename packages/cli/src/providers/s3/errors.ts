/** What the `s3` provider refuses, and how each is put right. */

import { GkmError } from '../../errors';

/** An `objects` entry for `s3` with a field it does not take or cannot use. */
export class S3ProviderConfigInvalid extends GkmError {
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
export class S3RegionRequired extends GkmError {
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
export class BucketNameUnavailable extends GkmError {
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
export class BucketOwnedByAnotherProject extends GkmError {
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
export class RecordedBucketUnreachable extends GkmError {
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
export class IamUserNotOwned extends GkmError {
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
export class AccessKeyLimit extends GkmError {
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
export class RotationInProgress extends GkmError {
	constructor(
		readonly id: string,
		readonly previous: string,
		readonly stage: string,
	) {
		super(
			`The bucket '${id}' is mid-rotation: its old key ${previous} is still ` +
				`active until '${stage}' is deployed with the new one: deploy it ` +
				`(gkm deploy --stage ${stage}) — the next deploy after that deletes ` +
				'the old key — or pass --retire-old-keys to delete it now, before rotating again.',
		);
		this.name = 'RotationInProgress';
	}
}

/** The stage's secrets point the bucket's key at a bucket gkm did not provision. */
export class BucketKeySetElsewhere extends GkmError {
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
export class ProvisionedBucketUnreachable extends GkmError {
	constructor(
		readonly id: string,
		readonly bucket: string,
		readonly stage: string,
		readonly reason: string,
	) {
		super(
			`The bucket '${bucket}' (${id}) cannot be reached with the key in the ` +
				`stage '${stage}''s secrets: ${reason}. Deploy '${stage}' with the ` +
				"stage account's credentials (gkm deploy --stage " +
				`${stage}), which creates or repairs it.`,
		);
		this.name = 'ProvisionedBucketUnreachable';
	}
}

/**
 * `verify()`: the bucket answers from another region than the one its URL
 * names — S3 redirects (301) or refuses the signature (400) and says where
 * the bucket is.
 */
export class BucketRegionMismatch extends GkmError {
	constructor(
		readonly id: string,
		readonly bucket: string,
		readonly stage: string,
		/** The secret holding the bucket's URL: `UPLOADS_URL`. */
		readonly key: string,
		readonly bucketRegion: string,
		/** The URL's `region`; absent when it names none. */
		readonly urlRegion: string | undefined,
		/** The region asked: the URL's, else the default it fell back to. */
		readonly askedRegion: string,
		/** What S3 answered: status, error, request ids. */
		readonly answer: string,
	) {
		const says = urlRegion
			? `says ${urlRegion}`
			: `names no region, so ${askedRegion} was asked`;
		super(
			`The bucket '${bucket}' (${id}) is in ${bucketRegion}, but ${key} in ` +
				`the stage '${stage}''s secrets ${says} (${answer}). Deploy ` +
				`'${stage}' with the stage account's credentials (gkm deploy --stage ` +
				`${stage}): the s3 provider reads the bucket's region and rewrites ` +
				`${key} with it. Set deploy.objects.${stage}.region to ` +
				`'${bucketRegion}' in gkm.config.ts so the stage's config says where ` +
				'its buckets are.',
		);
		this.name = 'BucketRegionMismatch';
	}
}

/** Neither `HeadBucket` nor `GetBucketLocation` says where a bucket is. */
export class BucketRegionUnknown extends GkmError {
	constructor(
		readonly bucket: string,
		/** What `HeadBucket` answered. */
		readonly head: string,
		/** What `GetBucketLocation` answered. */
		readonly location: string,
	) {
		super(
			`gkm cannot tell which region the bucket '${bucket}' is in: ` +
				`HeadBucket answered ${head}, and GetBucketLocation ${location}. ` +
				"Check that the provisioning credentials are the stage account's " +
				'and may call s3:GetBucketLocation on it, then run the deploy again.',
		);
		this.name = 'BucketRegionUnknown';
	}
}

/** `HeadBucket` answered neither yes, no, nor "another account's". */
export class BucketProbeFailed extends GkmError {
	constructor(
		readonly bucket: string,
		/** What S3 answered: status, error, request ids. */
		readonly answer: string,
	) {
		super(
			`gkm asked S3 whether the bucket '${bucket}' exists and got ${answer}. ` +
				"Check the provisioning credentials and the stage's region, then run the deploy again.",
		);
		this.name = 'BucketProbeFailed';
	}
}
