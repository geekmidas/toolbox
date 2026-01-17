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

/**
 * Patched EnvironmentParser that uses the global sniffer instance.
 *
 * This class wraps the global sniffer to maintain API compatibility
 * with the real EnvironmentParser. The constructor accepts an env
 * parameter for API compatibility but ignores it since we're sniffing.
 */
class PatchedEnvironmentParser {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	create(builder: (get: any) => any) {
		return globalThis.__envSniffer!.create(builder);
	}
}

// Export the patched parser as EnvironmentParser
export { PatchedEnvironmentParser as EnvironmentParser };

// Re-export other envkit exports that entry apps might use
export { SnifferEnvironmentParser } from '@geekmidas/envkit/sniffer';
