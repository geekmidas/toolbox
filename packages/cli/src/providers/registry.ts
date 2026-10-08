/**
 * The providers gkm ships, by kind and name — registered the way a deploy
 * target's built-ins are (`target/builtins.ts`). A provider from a package is
 * one more entry here once there is a loading story for it.
 */

import { s3Provider } from './s3/index.js';
import type { ProviderKind, ResourceProvider } from './types.js';

export const BUILTIN_PROVIDERS: {
	readonly [K in ProviderKind]: Readonly<
		Record<string, ResourceProvider<any, any>>
	>;
} = {
	objects: { s3: s3Provider },
};

/** The provider `kind` names `name`, if gkm has one. */
export function builtinProvider(
	kind: ProviderKind,
	name: string,
): ResourceProvider<any, any> | undefined {
	return Object.hasOwn(BUILTIN_PROVIDERS[kind], name)
		? BUILTIN_PROVIDERS[kind][name]
		: undefined;
}

/** The names `deploy.<kind>.<stage>` accepts, for messages. */
export function providerNames(kind: ProviderKind): string[] {
	return Object.keys(BUILTIN_PROVIDERS[kind]).sort();
}
