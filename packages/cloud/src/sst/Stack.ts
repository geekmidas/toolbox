import type { App, StageValues } from './App';

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

	/**
	 * Kebab-cased `{stage}-{appName}-{stackName}-{resource}` physical name.
	 * Delegates to the app's scheme (so the two can't drift) and includes the app
	 * name so resources stay unique across apps sharing an account/stage.
	 */
	logicalPrefixedName(resource: string): string {
		return this.app.logicalPrefixedName(`${this.name}-${resource}`);
	}

	select<T>(values: StageValues<TStage, T>): T {
		return this.app.select(values);
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
