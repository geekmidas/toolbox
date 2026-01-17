/**
 * Node.js module loader registration for entry app sniffing.
 *
 * This module registers a custom loader hook that intercepts imports of
 * '@geekmidas/envkit' and replaces the EnvironmentParser with
 * SnifferEnvironmentParser, allowing us to capture which environment
 * variables an entry app accesses.
 *
 * Usage:
 *   node --import tsx --import ./sniffer-loader.ts ./sniffer-worker.ts /path/to/entry.ts
 */

import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve path to the loader hooks module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const hooksPath = join(__dirname, 'sniffer-hooks.ts');

// Register the loader hooks
register(pathToFileURL(hooksPath).href, import.meta.url);
