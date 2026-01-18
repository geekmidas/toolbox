#!/usr/bin/env tsx
/**
 * Sync package versions from monorepo package.json files
 *
 * Run: pnpm --filter @geekmidas/cli sync-versions
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(__dirname, '../../'); // packages/cli/scripts -> packages/

const PACKAGES = [
	'audit',
	'auth',
	'cache',
	'client',
	'cloud',
	'constructs',
	'db',
	'emailkit',
	'envkit',
	'errors',
	'events',
	'logger',
	'rate-limit',
	'schema',
	'services',
	'storage',
	'studio',
	'telescope',
	'testkit',
] as const;

function getPackageVersion(pkgName: string): string {
	const pkgJsonPath = join(packagesDir, pkgName, 'package.json');
	try {
		const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
		return pkgJson.version;
	} catch (error) {
		console.error(`Failed to read version for ${pkgName}:`, error);
		throw error;
	}
}

function generateVersionsFile(): string {
	const versions: Record<string, string> = {};

	for (const pkg of PACKAGES) {
		const version = getPackageVersion(pkg);
		versions[`@geekmidas/${pkg}`] = `~${version}`;
	}

	const content = `/**
 * Package versions for @geekmidas packages
 *
 * AUTO-GENERATED - Do not edit manually
 * Run: pnpm --filter @geekmidas/cli sync-versions
 */
export const GEEKMIDAS_VERSIONS = {
${Object.entries(versions)
	.map(([pkg, version]) => `\t'${pkg}': '${version}',`)
	.join('\n')}
} as const;

export type GeekmidasPackage = keyof typeof GEEKMIDAS_VERSIONS;
`;

	return content;
}

// Main
const versionsPath = join(__dirname, '../src/init/versions.ts');
const content = generateVersionsFile();
writeFileSync(versionsPath, content);
console.log('✓ Updated packages/cli/src/init/versions.ts');

// Show versions
console.log('\nPackage versions:');
for (const pkg of PACKAGES) {
	const version = getPackageVersion(pkg);
	console.log(`  @geekmidas/${pkg}: ${version}`);
}
