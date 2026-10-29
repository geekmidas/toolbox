import { WildcardSiteNeedsDomain } from '../errors';
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
 *
 * A site on every subdomain (`tenants`) is the same distribution under one
 * `*.<domain>` alternate domain name: a wildcard certificate in us-east-1,
 * validated through the stack's hosted zone at deploy time, and one
 * `*.<domain>` alias record. Nothing is created per tenant — a tenant exists
 * because the app says so, and its `hosts` route is what answers an unknown
 * one. Every named host keeps its own record, which Route 53 prefers over the
 * wildcard, so `api.<domain>` is never the tenants' site.
 */
export class StaticSite<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.StaticSite
	implements GkmLinkable
{
	readonly _id!: string;
	private readonly tenants?: { domain: string; protectedSubdomains: string };

	get _type() {
		return ResourceType.StaticSite;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: StaticSiteProps = {},
	) {
		const { variant = 'static', tenants, ...args } = props;
		if (tenants && !_stack.domain) throw new WildcardSiteNeedsDomain(name);

		super(name, {
			// The variant's build, unless the caller supplied one. A site is
			// source until something builds it — uploading `path` directly is what
			// puts `src/` and `node_modules/` in a bucket — and *how* to build is
			// exactly what the variant knows and the declaration deliberately does
			// not.
			build: BUILDS[variant],
			// Every tenant's host on one distribution. SST requests the `*.`
			// certificate and validates it through the zone, then writes the
			// alias; a zone left unresolved is looked up by the domain's name.
			...(tenants
				? {
						domain: {
							name: `*.${_stack.domain}`,
							dns: sst.aws.dns(
								_stack.app.hostedZoneId
									? { zone: _stack.app.hostedZoneId }
									: {},
							),
						},
					}
				: {}),
			...args,
		});
		this._id = name;
		if (tenants) {
			this.tenants = {
				domain: _stack.domain,
				protectedSubdomains: tenants.protectedSubdomains.join(','),
			};
		}
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
		// A tenants' site is at `https://*.<domain>`, the address every target
		// gives it: what the surfaces it calls trust, one label in for the `*`.
		if (this.tenants) {
			return { url: `https://*.${this.tenants.domain}`, ...this.tenants };
		}
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
	/**
	 * Serve it on every subdomain of the stack's domain — a site declared
	 * `subdomain: '*'`. `protectedSubdomains` are the labels no tenant may
	 * take, provided to the site so it refuses them as slugs.
	 */
	tenants?: { protectedSubdomains: readonly string[] };
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
