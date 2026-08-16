import { provideKey } from '@geekmidas/manifest';
import { s3Url } from '@geekmidas/storage/aws';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `ObjectStorage` — a linkable S3 bucket (wraps `sst.aws.Bucket`), and the
 * infra half of the `objects` construct.
 *
 * The app declares the *names* it provides; this supplies the *values*. Both
 * sides describe the same contract without sharing an implementation — a shared
 * codec would have to contain `bucket` and `region`, which are S3's words, and
 * provider vocabulary in the neutral layer is the thing the design removes.
 *
 * Usable on its own. `Stack.fromManifest` translates a manifest into these, but
 * the component takes ordinary props so it works in a hand-written
 * `sst.config.ts` with no manifest anywhere.
 */
export class ObjectStorage<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.Bucket
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.ObjectStorage;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: ObjectStorageProps = {},
	) {
		super(name, props);
		this._id = name;
	}

	/**
	 * The env this bucket resolves onto anything that depends on it.
	 *
	 * Every part of the URL is read off the resource rather than inherited from
	 * the stack: a bucket may live in a different region than the function
	 * reading it, and `AWS_REGION` in a Lambda is the *function's* region — so
	 * omitting it breaks cross-region silently, at runtime.
	 *
	 * The name comes from the bucket too, not from a recomputed physical name:
	 * it may be supplied through props or generated, and only the resource knows.
	 */
	provides(): Record<string, $util.Input<string>> {
		return {
			[provideKey(this._id, 'url')]: $util
				.all([this.name, this.nodes.bucket.region])
				.apply(([bucket, region]) => s3Url.build({ bucket, region })),
		};
	}
}

export interface ObjectStorageProps extends sst.aws.BucketArgs {}
