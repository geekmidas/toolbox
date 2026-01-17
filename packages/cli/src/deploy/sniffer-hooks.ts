/**
 * Module loader hooks for entry app sniffing.
 *
 * This module provides the resolve hook that intercepts '@geekmidas/envkit'
 * imports and redirects them to the patched sniffer version.
 *
 * This file is registered via module.register() from sniffer-loader.ts.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve path to the patched envkit module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const patchedEnvkitPath = join(__dirname, 'sniffer-envkit-patch.ts');

type ResolveContext = {
	conditions: string[];
	importAttributes: Record<string, string>;
	parentURL?: string;
};

type ResolveResult = {
	url: string;
	shortCircuit?: boolean;
	format?: string;
};

type NextResolve = (
	specifier: string,
	context: ResolveContext,
) => Promise<ResolveResult>;

/**
 * Resolve hook - intercepts module resolution for @geekmidas/envkit
 */
export async function resolve(
	specifier: string,
	context: ResolveContext,
	nextResolve: NextResolve,
): Promise<ResolveResult> {
	// Intercept @geekmidas/envkit imports
	if (specifier === '@geekmidas/envkit') {
		return {
			url: `file://${patchedEnvkitPath}`,
			shortCircuit: true,
		};
	}

	return nextResolve(specifier, context);
}
