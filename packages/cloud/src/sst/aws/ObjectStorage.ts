import { s3Url } from '@geekmidas/storage/aws';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `ObjectStorage` — a linkable S3 bucket (wraps `sst.aws.Bucket`), and the
 * infra half of the `objects` construct.
 *
 * Its whole contribution is the link. SST injects the linked resource's
 * properties at runtime and `@geekmidas/envkit`'s resolvers turn them into the
 * env a construct reads — so composing a URL here would produce a value nothing
 * ever reads.
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
	 * The values this bucket resolves onto anything that depends on it, keyed by
	 * role. `provideKey` turns a role into the env key the app declared, so
	 * `url` here is `UPLOADS_URL` there.
	 *
	 * Composed *here* because only the resource knows its own shape: the name may
	 * be supplied through props or generated, and the region is the bucket's, not
	 * the reader's. It stays a method rather than being inlined below so the
	 * contract can be asserted — declared keys against supplied ones — without a
	 * deploy.
	 */
	provides(): Record<string, $util.Input<string>> {
		return {
			url: $util
				.all([this.name, this.nodes.bucket.region])
				.apply(([bucket, region]) => s3Url.build({ bucket, region })),
		};
	}

	/**
	 * The link carries those values, because the link is what reaches the running
	 * code: SST injects these properties and envkit's resolvers flatten them into
	 * env. Composing anywhere else produces a value nothing reads.
	 *
	 * The permissions `super` includes are untouched: what a link grants stays
	 * SST's business.
	 */
	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, ...this.provides() },
		};
	}
}

export interface ObjectStorageProps extends sst.aws.BucketArgs {}
