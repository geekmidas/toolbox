import type { App } from './App';
import { prefixedName } from './naming';

/**
 * Stack context: an `App` scoped to a logical stack name. Created via
 * `app.stack(name)` (see docs §5). Delegates `stage`/`region`/`domain` to the
 * app and prefixes resource names with the stack name.
 */
export class Stack<
	TStage extends string = string,
	TDomain extends string = string,
> {
	constructor(
		readonly app: App<TStage, TDomain>,
		/** This stack's logical name (e.g. `api`), used in resource prefixes. */
		readonly name: string,
	) {}

	get stage(): TStage {
		return this.app.stage;
	}

	get region(): string {
		return this.app.region;
	}

	get domain(): TDomain {
		return this.app.domain;
	}

	/** Kebab-cased, `{stage}-{stackName}-{resource}` physical name. */
	logicalPrefixedName(resource: string): string {
		return prefixedName([this.stage, this.name], resource);
	}

	select<T>(prodValue: T, other: T): T {
		return this.app.select(prodValue, other);
	}

	getSubdomain<TSub extends string>(subdomain: TSub) {
		return this.app.getSubdomain(subdomain);
	}

	getURL<TSub extends string>(subdomain?: TSub) {
		return this.app.getURL(subdomain);
	}
}

export type StackType<
	TStage extends string = string,
	TDomain extends string = string,
> = Stack<TStage, TDomain>;
