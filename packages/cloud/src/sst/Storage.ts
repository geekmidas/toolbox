import { type GkmLinkable, ResourceType } from './Linkable';
import type { StackType } from './Stack';

/**
 * `Storage` — a linkable S3 bucket (wraps `sst.aws.Bucket`). Link it to a
 * `Function`/`Api` route and the runtime resolves a `<NAME>_NAME` environment
 * variable (via the `Bucket` resolver in `@geekmidas/envkit/sst`) holding the
 * bucket's name — exactly what `@geekmidas/storage`'s `AmazonStorageClient`
 * consumes:
 *
 * ```ts
 * // app: a service backed by @geekmidas/storage
 * const storage = {
 *   serviceName: 'storage' as const,
 *   async register(env) {
 *     const { bucket } = env.create((get) => ({
 *       bucket: get('UPLOADS_NAME').string(),
 *     })).parse();
 *     return AmazonStorageClient.create({ bucket });
 *   },
 * };
 *
 * // infra: provision + link
 * const uploads = new Storage(stack, 'uploads');
 * new Function(stack, 'Upload', { handler, links: [uploads], envVars: ['UPLOADS_NAME'] });
 * ```
 *
 * The construct id (`uploads`) is the link's `_id`, which becomes the env-var
 * prefix; `StorageProps` extends `sst.aws.BucketArgs` so native options pass
 * through. Source-only (extends ambient `sst.aws.*`); see docs §2.
 */
export class Storage<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.Bucket
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.Bucket;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: StorageProps = {},
	) {
		super(name, props);
		this._id = name;
	}
}

export interface StorageProps extends sst.aws.BucketArgs {}
