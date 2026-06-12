/**
 * The minimal application/stack context the constructs need: identity (name),
 * deployment target (stage, region), and the resource-naming helper.
 *
 * This is the type the `Api`/`Function`/`Cron` constructs accept. The concrete
 * `App` and `Stack` classes (with Route53 resolution and `app.stack(name)`) are
 * the next foundation step — see `packages/cloud/docs/sst-constructs.md` §4–§5.
 */
export interface StackType<
	TStage extends string = string,
	TDomain extends string = string,
> {
	readonly name: string;
	readonly stage: TStage;
	readonly region: string;
	readonly domain?: TDomain;

	/** Kebab-cased, stage/name-prefixed physical resource name. */
	logicalPrefixedName(id: string): string;
}
