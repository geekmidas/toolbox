/**
 * Patched @geekmidas/envkit module for entry app sniffing.
 *
 * This module re-exports the SnifferEnvironmentParser as EnvironmentParser,
 * allowing entry apps to be imported while capturing their env var usage.
 *
 * The actual sniffer instance is stored in globalThis.__envSniffer
 * so the worker script can retrieve the captured variables.
 */

import { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';

// Extend globalThis type for the sniffer instance
declare global {
	// eslint-disable-next-line no-var
	var __envSniffer: SnifferEnvironmentParser | undefined;
}

// Create a shared sniffer instance that will be used by all imports
// This is stored globally so the worker script can access it
if (!globalThis.__envSniffer) {
	globalThis.__envSniffer = new SnifferEnvironmentParser();
}

// Type for the config parser returned by create()
interface ConfigParser<T> {
	parse(): T;
	safeParse(): { success: true; data: T } | { success: false; error: Error };
}

// Type for the env fetcher function
type EnvFetcher = (name: string) => {
	string(): { parse(): string; safeParse(): unknown };
	number(): { parse(): number; safeParse(): unknown };
	boolean(): { parse(): boolean; safeParse(): unknown };
	optional(): EnvFetcher;
	default(value: unknown): EnvFetcher;
};

/**
 * Patched EnvironmentParser that uses the global sniffer instance.
 *
 * This class wraps the global sniffer to maintain API compatibility
 * with the real EnvironmentParser. The constructor accepts an env
 * parameter for API compatibility but ignores it since we're sniffing.
 */
class PatchedEnvironmentParser {
	create<TReturn extends Record<string, unknown>>(
		builder: (get: EnvFetcher) => TReturn,
	): ConfigParser<TReturn> {
		return globalThis.__envSniffer!.create(builder as any) as unknown as ConfigParser<TReturn>;
	}
}

// Export the patched parser as EnvironmentParser
export { PatchedEnvironmentParser as EnvironmentParser };

// Re-export other envkit exports that entry apps might use
export { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';
