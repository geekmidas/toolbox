/**
 * What a server releases when it stops: the connections constructs opened.
 *
 * A construct that holds something open — a database's pool — registers how to
 * close it here, and the generated server runs every hook once it has stopped
 * taking requests. Without that, a rolling deploy has the old task and the new
 * one both holding connections until the old process dies.
 *
 * Kept free of any driver import so the server entry can always import it,
 * whether or not the app has a database.
 */

type ShutdownHook = () => Promise<void> | void;

// On globalThis, as Credentials are: a package loaded twice (ESM and CJS)
// would otherwise keep two registries, and the server would run the empty one.
const key = Symbol.for('@geekmidas/constructs/shutdown');
const registry = globalThis as Record<symbol, Set<ShutdownHook> | undefined>;
registry[key] ??= new Set<ShutdownHook>();
const hooks = registry[key];

/** Run `hook` when the server shuts down. Returns a function that removes it. */
export function onShutdown(hook: ShutdownHook): () => void {
	hooks.add(hook);
	return () => hooks.delete(hook);
}

/**
 * Run every registered hook, together, and wait for them. A hook that fails is
 * reported to `onError` and does not stop the others.
 */
export async function runShutdownHooks(
	onError: (error: unknown) => void = () => {},
): Promise<void> {
	await Promise.all(
		[...hooks].map(async (hook) => {
			try {
				await hook();
			} catch (error) {
				onError(error);
			}
		}),
	);
}
