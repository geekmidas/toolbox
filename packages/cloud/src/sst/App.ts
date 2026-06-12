import { prefixedName } from './naming';
import { Stack } from './Stack';

export interface AppProps<TStage extends string, TDomain extends string> {
	/** Application name; part of resource name prefixes. */
	name: string;
	/** Deployment stage, e.g. `dev` or `prod`. */
	stage: TStage;
	/** Root domain backed by a Route53 hosted zone. */
	domain: TDomain;
	/**
	 * Pre-resolved Route53 hosted zone id for `domain`. Resolve it once at the
	 * call site (`aws.route53.getZone`, or `getZoneOutput` for a lazy `Output`)
	 * and pass it in — the constructor stays synchronous (see docs §4).
	 */
	hostedZoneId: $util.Output<string> | string;
	/** AWS region. */
	region: string;
}

/**
 * Application-level context: identity, deployment target, and a pre-resolved
 * hosted zone. A plain synchronous constructor — zone resolution is the caller's
 * responsibility, so every construct stays uniform (`new X(...)`).
 */
export class App<
	TStage extends string = string,
	TDomain extends string = string,
> {
	readonly name: string;
	readonly stage: TStage;
	readonly domain: TDomain;
	readonly region: string;
	readonly hostedZoneId: $util.Output<string> | string;

	constructor(props: AppProps<TStage, TDomain>) {
		this.name = props.name;
		this.stage = props.stage;
		this.domain = props.domain;
		this.region = props.region;
		this.hostedZoneId = props.hostedZoneId;
	}

	/** Create a {@link Stack} bound to this app (sugar for `new Stack(app, name)`). */
	stack(name: string): Stack<TStage, TDomain> {
		return new Stack(this, name);
	}

	/** Returns `prodValue` when the stage is `prod`, else `other`. */
	select<T>(prodValue: T, other: T): T {
		return this.stage === 'prod' ? prodValue : other;
	}

	getSubdomain<TSub extends string>(subdomain: TSub) {
		return `${subdomain}.${this.domain}` as const;
	}

	getURL<TSub extends string>(subdomain?: TSub) {
		const prefix = subdomain ? (`${subdomain}.` as const) : '';
		return `https://${prefix}${this.domain}` as const;
	}

	/** Kebab-cased, stage/app-name-prefixed physical resource name. */
	logicalPrefixedName(id: string): string {
		return prefixedName([this.stage, this.name], id);
	}
}
