import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `StaticSite` — a built frontend on a distribution, and the infra half of the
 * `site` kind.
 *
 * The same infrastructure a file server is, which is why they are neighbours
 * here: a bucket, a distribution, a certificate and a domain. What differs is
 * only what sits in the bucket — a build output rather than live contents.
 *
 * Its `environment` is the interesting part and is not composed here. The values
 * a site inlines are derived from its *edges* by `publicEnvFor`, filtered by
 * which provided values may be shipped to a browser, and renamed by the
 * variant's prefix. That derivation is shared with the local target, so a site
 * built by `gkm dev` and the same site built by a deploy inline the same names.
 */
export class StaticSite<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.StaticSite
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.StaticSite;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: StaticSiteProps = {},
	) {
		super(name, props);
		this._id = name;
	}

	/**
	 * Where the site is served.
	 *
	 * Worth providing even though a browser gets there by typing it: an email
	 * templating a link back to the console needs this URL, and that is otherwise
	 * one more hand-maintained variable — the exact class of thing declaring a
	 * site was meant to remove.
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

export interface StaticSiteProps extends sst.aws.StaticSiteArgs {}
