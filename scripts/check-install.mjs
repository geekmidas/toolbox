#!/usr/bin/env node
/**
 * Every published entry point must load from a consumer's install.
 *
 * `check-exports` proves a declared path exists after a build. It cannot prove
 * the file at that path will *run*, because inside this repository every import
 * resolves whatever a `package.json` claims: pnpm links the whole workspace, so
 * an undeclared dependency and a correctly declared one look identical.
 *
 * They are not identical to anyone else. `10.0.0-alpha.1` shipped
 * `@geekmidas/constructs` with `envkit`, `errors`, `events`, `logger`,
 * `manifest`, `schema` and `services` as *optional* peers while importing all
 * of them from entries that always load. Installed on its own, not one entry
 * point loaded — and `gkm init` died on the first of them. Nothing here caught
 * it, because nothing here had ever installed a tarball.
 *
 * So this packs what would be published, installs it the way a consumer does
 * — into an empty project, with dependencies resolved from the packed set
 * rather than the workspace — and imports every entry the `exports` map
 * declares. An entry that throws `ERR_MODULE_NOT_FOUND` is a missing
 * dependency, whatever the peer block says about it.
 *
 * Optional peers are the point of the exercise, not a nuisance: an entry is
 * allowed to fail on one, because that is what opting in means. Each package
 * lists the ones it may fail on; anything else is a fault.
 */

import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');

/**
 * Packages an entry is allowed to be missing, because installing them is how a
 * consumer opts into that integration.
 *
 * Keep this list short and justified. Every name here is a feature somebody has
 * to install something extra to use; a name added to silence a failure turns
 * this check back into the thing it replaced.
 */
const OPTIONAL = new Set([
	'@geekmidas/audit',
	'@geekmidas/cache',
	'@geekmidas/db',
	'@geekmidas/emailkit',
	'@geekmidas/rate-limit',
	'@geekmidas/storage',
	'@geekmidas/telescope',
	// Transport and provider SDKs: which broker or cloud you use is a choice,
	// and the entry for one you do not use has no business being installable.
	'@aws-sdk/client-s3',
	'@aws-sdk/client-sns',
	'@aws-sdk/client-sqs',
	'amqplib',
	'expo-secure-store',
	'ioredis',
	'pg-boss',
	'pino-abstract-transport',
	'@upstash/redis',
	// Frameworks and UI libraries a consumer brings.
	'@middy/core',
	'@tanstack/react-query',
	'@types/aws-lambda',
	'better-auth',
	'hono',
	'kysely',
	'msw',
	'pg',
	'react',
	// Test-only. `@geekmidas/testkit` is imported by test files, which run under
	// a runner the consumer already has.
	'vitest',
]);

function run(command, args, cwd) {
	return execFileSync(command, args, {
		cwd,
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 64 * 1024 * 1024,
	});
}

/** The publishable packages, and where their tarball landed. */
function packAll(into) {
	const packed = new Map();

	for (const directory of readdirSync(join(root, 'packages'))) {
		const packagePath = join(root, 'packages', directory, 'package.json');
		if (!existsSync(packagePath)) continue;

		const manifest = JSON.parse(readFileSync(packagePath, 'utf-8'));
		if (manifest.private || !manifest.name) continue;

		// `pnpm pack`, not `npm pack`: only pnpm rewrites the `workspace:`
		// protocol into a real range, which is the manifest that gets published
		// and therefore the only one worth testing.
		const out = run(
			'pnpm',
			['pack', '--pack-destination', into],
			join(root, 'packages', directory),
		);
		const tarball = out.trim().split('\n').pop().trim();

		packed.set(manifest.name, { tarball, manifest });
	}

	return packed;
}

/** Entry specifiers a package declares, e.g. `@geekmidas/cli/openapi`. */
function entriesOf(manifest) {
	const out = [];

	for (const subpath of Object.keys(manifest.exports ?? { '.': {} })) {
		if (subpath.includes('*')) continue;
		out.push(
			subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
		);
	}

	return out;
}

const workdir = mkdtempSync(join(tmpdir(), 'gkm-install-check-'));
const tarballs = join(workdir, 'tgz');
run('mkdir', ['-p', tarballs]);

console.log('Packing publishable packages...');
const packed = packAll(tarballs);
console.log(`  ${packed.size} packages packed.\n`);

/**
 * The workspace packages one package actually pulls in.
 *
 * Overriding every package in every project is what a consumer never does, and
 * it manufactures conflicts: forcing `@geekmidas/telescope` into a project that
 * does not want it drags its own optional peers in behind it, and npm refuses
 * the resolution. Only a package's own closure gets overridden.
 */
function closureOf(name, seen = new Set()) {
	if (seen.has(name) || !packed.has(name)) return seen;
	seen.add(name);

	const { manifest } = packed.get(name);
	const meta = manifest.peerDependenciesMeta ?? {};
	const direct = [
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}).filter(
			(p) => !meta[p]?.optional,
		),
	];

	for (const next of direct) closureOf(next, seen);

	return seen;
}

const failures = [];
const ignored = [];
let checked = 0;

// One project per package, because that is how a consumer installs: reaching
// for `@geekmidas/constructs` alone, not for all twenty-one at once. Installing
// them together also forces every optional peer to resolve simultaneously,
// which manufactures version conflicts nobody would actually meet.
for (const [name, { tarball, manifest }] of packed) {
	const project = join(workdir, name.replace(/[@/]/g, '_'));
	run('mkdir', ['-p', project]);
	writeFileSync(
		join(project, 'package.json'),
		`${JSON.stringify(
			{
				name: 'install-check',
				type: 'module',
				private: true,
				dependencies: { [name]: `file:${tarball}` },
				// Transitive workspace packages resolve to the tarballs just built,
				// so a fault in one is never masked by a working copy on the registry.
				overrides: Object.fromEntries(
					[...closureOf(name)].map((n) => [n, `file:${packed.get(n).tarball}`]),
				),
			},
			null,
			2,
		)}\n`,
	);

	try {
		run(
			'npm',
			['install', '--no-audit', '--no-fund', '--prefer-offline'],
			project,
		);
	} catch (error) {
		const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
		failures.push({
			entry: name,
			reason: `install failed: ${(text.match(/npm error (.*)/)?.[1] ?? '').trim()}`,
		});
		continue;
	}

	for (const entry of entriesOf(manifest)) {
		checked++;
		try {
			run(
				'node',
				['--input-type=module', '-e', `await import(${JSON.stringify(entry)})`],
				project,
			);
		} catch (error) {
			const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
			const missing = text.match(/Cannot find package '([^']+)'/)?.[1];

			// This check is about one thing: a package an entry imports that a
			// consumer's install does not provide. An entry that loads and then
			// throws for its own reasons has resolved everything it needed, which
			// is what was being asked. `@geekmidas/cloud/sst` is TypeScript on
			// purpose, for SST's loader rather than bare node; `@geekmidas/ui/styles`
			// is a stylesheet; the CLI root runs a program when imported. None of
			// those is a missing dependency, and none belongs in an allowlist.
			if (!missing) {
				ignored.push(entry);
				continue;
			}

			// Opting in is allowed to be opted out of. OpenTelemetry is a family
			// rather than a package — telescope declares thirteen of them, all
			// optional — so it is matched by prefix instead of listed thirteen times.
			if (OPTIONAL.has(missing) || missing.startsWith('@opentelemetry/')) {
				continue;
			}

			failures.push({ entry, reason: `missing ${missing}` });
		}
	}
}

if (!keep) rmSync(workdir, { recursive: true, force: true });
else console.log(`Left the install at ${workdir}\n`);

if (failures.length > 0) {
	console.error(
		`\n${failures.length} of ${checked} entry points do not load when installed:\n`,
	);
	for (const { entry, reason } of failures)
		console.error(`  ${entry}  ->  ${reason}`);
	console.error(
		'\nAn entry that imports a package at runtime needs it in `dependencies`.\n' +
			'An optional peer is for something a consumer opts into by installing it —\n' +
			'not for something the entry imports unconditionally.\n',
	);
	process.exit(1);
}

console.log(
	`All ${checked} entry points resolve their dependencies from a consumer install.`,
);
if (ignored.length > 0) {
	console.log(
		`  (${ignored.length} did not execute under bare node — TypeScript, CSS or a program — but resolved.)`,
	);
}
