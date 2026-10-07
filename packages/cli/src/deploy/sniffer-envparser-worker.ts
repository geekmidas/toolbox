/**
 * Subprocess worker for envParser sniffing.
 *
 * Imports an app's envParser module, hands it a SnifferEnvironmentParser and
 * reports which variables it read. A subprocess, like the entry and route
 * sniffers, so the module runs in the sandbox rather than in the deploy, with
 * none of the deploy's environment.
 *
 * Usage:
 *   node --import tsx ./sniffer-envparser-worker.ts /path/to/env.ts envParser
 *
 * Output (JSON, last line of stdout):
 *   { "envVars": [...], "optionalEnvVars": [...], "unhandledRejections": [...],
 *     "warnings": [...], "error": null }
 */

import { pathToFileURL } from 'node:url';
import {
	SnifferEnvironmentParser,
	sniffWithFireAndForget,
} from '@geekmidas/envkit/sniffer';

const modulePath = process.argv[2];
const exportName = process.argv[3] ?? 'default';

async function sniff(): Promise<void> {
	const warnings: string[] = [];
	const sniffer = new SnifferEnvironmentParser();

	const result = await sniffWithFireAndForget(sniffer, async () => {
		if (!modulePath) throw new TypeError('No envParser module was given.');
		const module = await import(pathToFileURL(modulePath).href);

		const envParser = module[exportName];
		if (typeof envParser !== 'function') {
			warnings.push(
				`[sniffer] Export "${exportName}" from "${modulePath}" is not a function`,
			);
			return;
		}

		// The envParser function typically creates and configures an
		// EnvironmentParser; the sniffer implements the same interface.
		const parser = envParser(sniffer);

		// A ConfigParser's parse() is what reads the variables.
		if (parser && typeof parser.parse === 'function') {
			try {
				parser.parse();
			} catch {
				// Parsing may fail on the sniffer's mock values; expected.
			}
		}
	});

	const line = JSON.stringify({
		envVars: result.envVars,
		optionalEnvVars: result.optionalEnvVars,
		unhandledRejections: result.unhandledRejections.map((e) => e.message),
		warnings,
		error: result.error ? result.error.message : null,
	});
	// The module may have left a pool or a timer open, so exit — once the
	// answer has drained: a pipe on macOS is written asynchronously.
	process.stdout.write(`${line}\n`, () => process.exit(0));
}

sniff().catch((e) => {
	console.log(JSON.stringify({ envVars: [], error: e.message || String(e) }));
	process.exit(1);
});
