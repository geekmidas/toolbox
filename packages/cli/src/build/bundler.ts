import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface BundleOptions {
  /** Entry point file (e.g., .gkm/server/server.ts) */
  entryPoint: string;
  /** Output directory for bundled files */
  outputDir: string;
  /** Minify the output (default: true) */
  minify: boolean;
  /** Generate sourcemaps (default: false) */
  sourcemap: boolean;
  /** Packages to exclude from bundling */
  external: string[];
}

/**
 * Bundle the server application using tsdown
 *
 * @param options - Bundle configuration options
 */
export async function bundleServer(options: BundleOptions): Promise<void> {
  const { entryPoint, outputDir, minify, sourcemap, external } = options;

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Generate tsdown config for production bundle
  const tsdownConfig = {
    entry: [entryPoint],
    outDir: outputDir,
    format: ['esm'] as const,
    platform: 'node' as const,
    target: 'node22',
    minify,
    sourcemap,
    external: [
      // Always exclude node: builtins
      'node:*',
      // User-specified externals
      ...external,
    ],
    banner: {
      js: '#!/usr/bin/env node',
    },
    clean: true,
    // Output as .mjs for explicit ESM
    outExtension: {
      '.js': '.mjs',
    },
  };

  const configPath = join(outputDir, 'tsdown.bundle.config.json');
  await writeFile(configPath, JSON.stringify(tsdownConfig, null, 2));

  try {
    // Run tsdown with the config
    // Use npx to ensure we use the locally installed version
    execSync(`npx tsdown --config ${configPath}`, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
  } catch (error) {
    // Clean up config file on error
    throw new Error(
      `Failed to bundle server: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
