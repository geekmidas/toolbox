import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `FileServer` — a CloudFront distribution over a bucket, and the infra half of
 * the `file-server` kind.
 *
 * It owns the certificate and the DNS record, which is the whole reason the
 * construct is its own rather than a flag on the bucket: a domain lifecycle has
 * no business living inside an `objects` provisioner. It is also the same
 * infrastructure a static site is — a distribution over an origin — with live
 * bucket contents in place of a build output.
 *
 * The origin bucket must permit CloudFront to read it, which is set on the
 * *bucket* rather than here: `fromManifest` gives a bucket `access:
 * 'cloudfront'` when anything in the manifest serves it. That lookup is the cost
 * this design named — the bucket alone no longer says whether it is served, so
 * you find whoever points at it — paid once, in one place.
 *
 * What it does **not** do is signing. A CloudFront signed URL or signed cookie
 * needs a key group and a private key, which is key material nothing declares
 * yet; the construct's `signedUrl` is an S3 presign at the bucket instead. So
 * open paths are served here, and a signed read goes to the bucket's own host.
 * That is a real difference in hostname, and it is documented rather than hidden
 * because a presign and a CloudFront signature share only the word "signed".
 */
export class FileServer<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.Router
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.FileServer;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: FileServerProps,
	) {
		const { origin, ...args } = props;

		super(name, args);
		this._id = name;

		// Everything at the root, so a served path *is* a bucket key and the
		// client's `url(key)` and `getUploadURL(key)` speak the same language.
		// Several origins would cost exactly that, which is why multi-origin is
		// deferred until something asks for it.
		this.routeBucket('/*', origin);
	}

	/**
	 * The one value this server resolves: where its objects answer.
	 *
	 * A custom domain when one is configured and the distribution's assigned
	 * hostname otherwise — `Router.url` already prefers the former. The assigned
	 * hostname is a fallback rather than a destination: it changes if the
	 * distribution is replaced, which turns every URL anyone emailed or cached
	 * into a dead one.
	 */
	provides(): Record<string, $util.Input<string>> {
		return { url: this.url };
	}

	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, ...this.provides() },
		};
	}
}

export interface FileServerProps extends sst.aws.RouterArgs {
	/** The bucket whose objects this serves. */
	origin: sst.aws.Bucket;
}
