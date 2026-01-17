/**
 * Node.js module loader registration for entry app sniffing.
 *
 * This module registers a custom loader hook that intercepts imports of
 * '@geekmidas/envkit' and replaces the EnvironmentParser with
 * SnifferEnvironmentParser, allowing us to capture which environment
 * variables an entry app accesses.
 *
 * Usage:
 *   node --import tsx --import ./sniffer-loader.mjs ./sniffer-worker.mjs /path/to/entry.ts
 */

import { existsSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve path to the loader hooks module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try .mjs first (production dist), then .ts (development)
const mjsPath = join(__dirname, 'sniffer-hooks.mjs');
const tsPath = join(__dirname, 'sniffer-hooks.ts');
const hooksPath = existsSync(mjsPath) ? mjsPath : tsPath;

// Register the loader hooks
register(pathToFileURL(hooksPath).href, import.meta.url);
