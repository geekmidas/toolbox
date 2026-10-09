import {
	DeleteBucketCommand,
	DeleteObjectsCommand,
	ListObjectsV2Command,
	ListObjectVersionsCommand,
	type S3Client,
} from '@aws-sdk/client-s3';

/** Remove a bucket a suite made: every object, every version, then it. */
export async function removeBucket(
	s3: S3Client,
	bucket: string,
): Promise<void> {
	for (let pass = 0; pass < 10; pass++) {
		const versions = await s3.send(
			new ListObjectVersionsCommand({ Bucket: bucket }),
		);
		const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
		const objects = [
			...(versions.Versions ?? []),
			...(versions.DeleteMarkers ?? []),
		].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
		const current = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
		if (objects.length === 0 && current.length === 0) break;
		for (const batch of [objects, current]) {
			if (batch.length === 0) continue;
			await s3.send(
				new DeleteObjectsCommand({
					Bucket: bucket,
					Delete: { Objects: batch },
				}),
			);
		}
	}
	await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
}
