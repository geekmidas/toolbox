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
		const { variant = 'static', ...args } = props;

		super(name, {
			// The variant's build, unless the caller supplied one. A site is
			// source until something builds it — uploading `path` directly is what
			// puts `src/` and `node_modules/` in a bucket — and *how* to build is
			// exactly what the variant knows and the declaration deliberately does
			// not.
			build: BUILDS[variant],
			...args,
		});
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

export interface StaticSiteProps extends sst.aws.StaticSiteArgs {
	/** Which framework builds it, for the default build command. */
	variant?: 'static' | 'next' | 'tanstack';
}

/**
 * How each variant builds, and where it leaves the result.
 *
 * One neutral name from the construct, one build per framework — the same
 * arrangement the `VITE_`/`NEXT_PUBLIC_` prefixes have, and for the same
 * reason: the framework changes the code you write, so it changes this and
 * nothing else.
 */
const BUILDS: Record<
	NonNullable<StaticSiteProps['variant']>,
	{ command: string; output: string }
> = {
	static: { command: 'npm run build', output: 'dist' },
	tanstack: { command: 'npm run build', output: 'dist' },
	// Next's static export lands in `out`, not `dist`.
	next: { command: 'npm run build', output: 'out' },
};
