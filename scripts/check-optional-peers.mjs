#!/usr/bin/env node

/**
 * An optional peer is imported only by the entry that is named for it.
 *
 * A package declares a peer optional when a consumer opts into it by
 * installing it: `ioredis` for `@geekmidas/cache/redis`, the AWS SDK for
 * `@geekmidas/storage/aws`. That promise holds only while nothing *else* in
 * the package imports it. Each time it broke, it broke the same way — a
 * general entry (`./crons`, `./worker`, the CLI root) reached an optional peer
 * through a shared chunk, and a project that never touched the feature failed
 * to load or to build: `@aws-sdk/client-kms` (#268), the schema converters'
 * peers (#341), `@geekmidas/emailkit` (#360), `@middy/core` (#371).
 *
 * `check-install` cannot see this. It allows any entry to fail on an optional
 * peer, because some entries exist to need one — and the entries that should
 * not need one look the same to it. So this reads what would be published:
 * from every `exports` entry, ESM and CJS, it follows the built files'
 * imports — relative chunks, the package's own subpaths and the workspace
 * packages it depends on — and lists every optional peer reached, by a
 * top-level import or by an `import()` / `require()` anywhere. A dynamic
 * import counts: a bundler resolves its specifier at build time whether or not
 * the branch ever runs (#341).
 *
 * An entry may reach an optional peer by a top-level import only when
 * `ALLOWED` below says it is that peer's adaptor. Otherwise only through an
 * `import()` inside a `try` (or with a `.catch`), which a bundler leaves to
 * run time and whose error names what to install. Anything else fails.
 *
 *   node scripts/check-optional-peers.mjs           check; exit 1 on a fault
 *   node scripts/check-optional-peers.mjs --report  every entry and the
 *                                                   optional peers it reaches
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const report = process.argv.includes('--report');

/**
 * Which optional peers each entry exists to need: it is that peer's adaptor.
 *
 * Keyed by package, then by entry. A peer listed here may be reached from that
 * entry by a top-level import. Every line says why using the entry already
 * means having the peer; an entry added only to silence a failure is the bug
 * this check replaces. A listed peer the entry no longer reaches fails too, so
 * the list stays true and can be read as the packages' documentation.
 */
export const ALLOWED = {
	'@geekmidas/cache': {
		// Each is the cache on that backend.
		'./expo': ['expo-secure-store'],
		'./postgres': ['pg'],
		'./redis': ['ioredis'],
		'./upstash': ['@upstash/redis'],
	},
	'@geekmidas/client': {
		// React Query hooks: typed per endpoint, per OpenAPI path, and the
		// query client itself.
		'./endpoint-hooks': ['@tanstack/react-query', 'react'],
		'./openapi': ['@tanstack/react-query'],
		'./react-query': ['@tanstack/react-query', 'react'],
	},
	'@geekmidas/constructs': {
		// The Lambda adaptor: every handler is wrapped in middy.
		'./aws': ['@middy/core'],
		// A database construct is a Kysely client over a pg pool.
		'./database/kysely': ['kysely', 'pg'],
		// The KMS cipher driver, registered by an AWS entry (#268).
		'./encryption/kms': ['@aws-sdk/client-kms'],
		// Buckets and the file server are clients of @geekmidas/storage.
		'./file-server': ['@geekmidas/storage'],
		'./object-storage': ['@geekmidas/storage'],
		// The Hono adaptor.
		'./hono': ['hono'],
		// An Inbox parses mail with emailkit and keeps it in a bucket.
		'./inbox': ['@geekmidas/emailkit', '@geekmidas/storage'],
		// The feature-test harness: Hono serves the app in process, MSW routes
		// its fetches, testkit builds the context, and each test runs in a
		// Postgres transaction through Kysely.
		'./testing': ['@geekmidas/testkit', 'hono', 'kysely', 'msw', 'pg'],
	},
	'@geekmidas/events': {
		// Each is the publisher and subscriber on that broker. An SNS topic's
		// subscriber drains an SQS queue subscribed to it.
		'./pgboss': ['pg-boss'],
		'./rabbitmq': ['amqplib'],
		'./sns': ['@aws-sdk/client-sns', '@aws-sdk/client-sqs'],
		'./sqs': ['@aws-sdk/client-sqs'],
	},
	'@geekmidas/logger': {
		'./pino': ['pino'],
	},
	'@geekmidas/storage': {
		// The S3 client.
		'./aws': [
			'@aws-sdk/client-s3',
			'@aws-sdk/s3-presigned-post',
			'@aws-sdk/s3-request-presigner',
		],
	},
	'@geekmidas/telescope': {
		// OpenTelemetry's span, flush and processor helpers.
		'./core': ['@opentelemetry/api', '@opentelemetry/sdk-trace-base'],
		// The Telescope dashboard API and recorder, mounted on Hono.
		'./hono': ['hono'],
		'./server/hono': ['hono'],
		'./otlp/hono': ['hono'],
		// The process's OpenTelemetry setup: the SDK, its exporters and the
		// server's request spans. `gkm`'s generated server entry loads it
		// behind a guarded import(), and that server is a Hono app.
		'./instrumentation': [
			'@opentelemetry/api',
			'@opentelemetry/auto-instrumentations-node',
			'@opentelemetry/exporter-logs-otlp-http',
			'@opentelemetry/exporter-trace-otlp-http',
			'@opentelemetry/instrumentation-pino',
			'@opentelemetry/resources',
			'@opentelemetry/sdk-logs',
			'@opentelemetry/sdk-node',
			'@opentelemetry/sdk-trace-base',
			'@opentelemetry/sdk-trace-node',
			'@opentelemetry/semantic-conventions',
			'hono',
		],
		'./instrumentation/hono': ['@opentelemetry/api', 'hono'],
		'./lambda': ['@opentelemetry/api', '@opentelemetry/sdk-trace-base'],
		// A pino transport is built on pino-abstract-transport.
		'./logger/pino': ['pino-abstract-transport'],
	},
	'@geekmidas/testkit': {
		// Mocks made with vitest's `vi`.
		'./aws': ['vitest'],
		'./logger': ['vitest'],
		'./os': ['vitest'],
		'./better-auth': ['better-auth'],
		// Test databases: Postgres through Kysely or Objection, and the
		// transaction each test runs in.
		'./kysely': ['kysely', 'pg'],
		'./objection': ['pg'],
		'./postgres': ['pg'],
		'./transactions': ['kysely', 'pg'],
	},
};

const BUILTINS = new Set(builtinModules);

/** `@a/b/c` → `@a/b`, `a/b` → `a`. */
function packageOf(specifier) {
	const parts = specifier.split('/');
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Every publishable workspace package, by name. */
function workspacePackages() {
	const out = new Map();
	for (const directory of readdirSync(join(root, 'packages'))) {
		const path = join(root, 'packages', directory, 'package.json');
		if (!existsSync(path)) continue;
		const manifest = JSON.parse(readFileSync(path, 'utf-8'));
		if (manifest.private || !manifest.name) continue;
		out.set(manifest.name, {
			dir: join(root, 'packages', directory),
			manifest,
		});
	}
	return out;
}

const packages = workspacePackages();

/** The optional peers a manifest declares. */
function optionalPeers(manifest) {
	return new Set(
		Object.keys(manifest.peerDependencies ?? {}).filter(
			(name) => manifest.peerDependenciesMeta?.[name]?.optional,
		),
	);
}

/** Packages a manifest guarantees are installed when it is. */
function required(manifest) {
	const peers = manifest.peerDependencies ?? {};
	return new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(peers).filter(
			(name) => !manifest.peerDependenciesMeta?.[name]?.optional,
		),
	]);
}

/** The file an `exports` target resolves to under one condition. */
function pick(target, condition) {
	if (typeof target === 'string') return target;
	if (!target || typeof target !== 'object') return undefined;
	for (const key of [condition, 'node', 'default']) {
		if (key in target) {
			const found = pick(target[key], condition);
			if (found) return found;
		}
	}
	return undefined;
}

/** `[subpath, file]` for each non-wildcard entry, under one condition. */
function entryFiles(pkg, condition) {
	const exports = pkg.manifest.exports ?? { '.': pkg.manifest.main };
	const out = [];
	for (const [subpath, target] of Object.entries(exports)) {
		if (subpath.includes('*') || subpath === './package.json') continue;
		const file = pick(target, condition);
		if (!file || !/\.(m|c)?js$/.test(file)) continue;
		out.push([subpath, join(pkg.dir, file)]);
	}
	return out;
}

/**
 * Entries published as TypeScript source rather than built JavaScript —
 * `@geekmidas/cloud/sst`, read by SST's own loader, which provides the
 * `@pulumi/*` packages it imports. There is no built file to walk.
 */
function sourceEntries(pkg) {
	const out = [];
	for (const [subpath, target] of Object.entries(pkg.manifest.exports ?? {})) {
		const file = pick(target, 'import');
		if (file && /\.(m|c)?tsx?$/.test(file)) out.push(subpath);
	}
	return out;
}

/** The entry a bare specifier into a workspace package names. */
function resolveWorkspace(specifier, condition) {
	const name = packageOf(specifier);
	const pkg = packages.get(name);
	if (!pkg) return undefined;
	const subpath = `.${specifier.slice(name.length)}`;
	const target = pkg.manifest.exports?.[subpath];
	const file = target && pick(target, condition);
	return file ? { pkg, file: join(pkg.dir, file) } : undefined;
}

function resolveRelative(from, specifier) {
	const base = resolve(dirname(from), specifier);
	for (const candidate of [base, `${base}.mjs`, `${base}.cjs`, `${base}.js`]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return undefined;
}

const parsed = new Map();

/**
 * The module specifiers a built file names, and whether each is loaded when
 * the file loads (`static`) or later (`dynamic`: an `import()`, or a
 * `require()` inside a function).
 */
function importsOf(file) {
	if (parsed.has(file)) return parsed.get(file);
	const source = readFileSync(file, 'utf-8');
	const sourceType = file.endsWith('.cjs') ? 'script' : 'module';
	const ast = parse(source, {
		ecmaVersion: 'latest',
		sourceType,
		allowHashBang: true,
		allowReturnOutsideFunction: true,
		allowAwaitOutsideFunction: true,
	});

	const found = [];
	const literal = (node) =>
		node?.type === 'Literal' && typeof node.value === 'string'
			? node.value
			: node?.type === 'TemplateLiteral' && node.expressions.length === 0
				? node.quasis[0].value.cooked
				: undefined;

	const visit = (node, inFunction, inTry) => {
		if (!node || typeof node.type !== 'string') return;
		if (node.type === 'TryStatement') {
			visit(node.block, inFunction, true);
			visit(node.handler, inFunction, inTry);
			visit(node.finalizer, inFunction, inTry);
			return;
		}
		switch (node.type) {
			case 'ImportDeclaration':
				// `import type` never survives a build; the guard is for values.
				found.push({ specifier: node.source.value, kind: 'static' });
				return;
			case 'ExportNamedDeclaration':
			case 'ExportAllDeclaration':
				if (node.source) {
					found.push({ specifier: node.source.value, kind: 'static' });
				}
				break;
			case 'ImportExpression': {
				const specifier = literal(node.source);
				if (specifier) {
					found.push({ specifier, kind: 'dynamic', guarded: inTry });
				}
				break;
			}
			case 'CallExpression': {
				// `import('x').catch(…)` is guarded the way a `try` is.
				const callee = node.callee;
				if (
					callee.type === 'MemberExpression' &&
					callee.object.type === 'ImportExpression' &&
					callee.property.name === 'catch'
				) {
					const caught = literal(callee.object.source);
					if (caught) {
						found.push({ specifier: caught, kind: 'dynamic', guarded: true });
					}
					for (const argument of node.arguments) {
						visit(argument, true, inTry);
					}
					return;
				}
				const specifier =
					node.callee.type === 'Identifier' &&
					node.callee.name === 'require' &&
					literal(node.arguments[0]);
				if (specifier) {
					found.push({
						specifier,
						kind: inFunction ? 'dynamic' : 'static',
						guarded: inFunction && inTry,
					});
				}
				break;
			}
		}
		const nested =
			inFunction ||
			node.type === 'FunctionDeclaration' ||
			node.type === 'FunctionExpression' ||
			node.type === 'ArrowFunctionExpression';
		for (const key of Object.keys(node)) {
			const value = node[key];
			if (Array.isArray(value)) {
				for (const child of value) visit(child, nested, inTry);
			} else if (value && typeof value === 'object' && key !== 'loc') {
				visit(value, nested, inTry);
			}
		}
	};
	visit(ast, false, false);

	parsed.set(file, found);
	return found;
}

/**
 * How an import loads, weakest last. A path is as strong as its weakest
 * edge: anything beneath a guarded `import()` fails, if it fails, at that
 * guard.
 */
const STATIC = 2;
const DYNAMIC = 1;
const GUARDED = 0;
const MODE = ['guarded', 'dynamic', 'static'];

const modeOf = ({ kind, guarded }) =>
	kind === 'static' ? STATIC : guarded ? GUARDED : DYNAMIC;

/**
 * The optional peers an entry reaches: `peer → { mode, via }`, the strongest
 * way it is reached.
 *
 * `owner` is the package being checked. Inside a workspace package it
 * installs, that package's own optional peers count too, unless `owner`
 * installs them; an optional workspace peer of `owner` is a peer in its own
 * right, so it is reported and not walked into.
 */
function reach(owner, entryFile, condition) {
	const ownerOptional = optionalPeers(owner.manifest);
	const ownerRequired = required(owner.manifest);
	const hits = new Map();
	const best = new Map();

	const record = (peer, mode, via) => {
		if ((hits.get(peer)?.mode ?? -1) < mode) hits.set(peer, { mode, via });
	};

	const walk = (file, pkg, mode, via) => {
		if ((best.get(file) ?? -1) >= mode) return;
		best.set(file, mode);

		const optional =
			pkg === owner ? ownerOptional : optionalPeers(pkg.manifest);
		const here = [...via, relative(pkg.dir, file)];

		for (const edge of importsOf(file)) {
			const { specifier } = edge;
			const next = Math.min(mode, modeOf(edge));

			if (specifier.startsWith('.')) {
				const target = resolveRelative(file, specifier);
				if (target) walk(target, pkg, next, via);
				continue;
			}
			if (specifier.startsWith('node:')) continue;
			if (BUILTINS.has(specifier) || BUILTINS.has(packageOf(specifier))) {
				continue;
			}

			const name = packageOf(specifier);
			const path = [...here, specifier];

			if (
				ownerOptional.has(name) ||
				(optional.has(name) && !ownerRequired.has(name))
			) {
				record(name, next, path);
				continue;
			}

			// The package's own subpaths, and the workspace packages it installs:
			// what they import loads with this entry, so they are walked too.
			if (packages.has(name)) {
				const target = resolveWorkspace(specifier, condition);
				if (target) walk(target.file, target.pkg, next, path);
			}
		}
	};

	walk(entryFile, owner, STATIC, []);
	return hits;
}

/** Every entry of every package, and the optional peers it reaches. */
export function audit() {
	const rows = [];
	const unbuilt = [];

	for (const [name, pkg] of packages) {
		const entries = new Map();

		for (const condition of ['import', 'require']) {
			for (const [subpath, file] of entryFiles(pkg, condition)) {
				if (!existsSync(file)) {
					unbuilt.push(`${name} ${subpath}: ${relative(root, file)}`);
					continue;
				}
				const merged = entries.get(subpath) ?? new Map();
				for (const [peer, hit] of reach(pkg, file, condition)) {
					if ((merged.get(peer)?.mode ?? -1) < hit.mode) {
						merged.set(peer, { ...hit, condition });
					}
				}
				entries.set(subpath, merged);
			}
		}

		const allowed = ALLOWED[name] ?? {};
		for (const [subpath, hits] of entries) {
			for (const [peer, { mode, via, condition }] of hits) {
				const adaptor = (allowed[subpath] ?? []).includes(peer);
				rows.push({
					name,
					subpath,
					peer,
					mode: MODE[mode],
					condition,
					via,
					// A guarded `import()` is how an entry loads a peer for a feature
					// only some users turn on: a bundler leaves it to run time, and
					// the error names what to install. Anything stronger must come
					// from the entry that exists for that peer.
					ok: adaptor || mode === GUARDED,
					adaptor,
				});
			}
		}
	}

	// An allowance nothing needs any more: the entry was fixed, renamed or
	// removed. Left in, it would quietly permit the next regression.
	const stale = [];
	for (const [name, entries] of Object.entries(ALLOWED)) {
		for (const [subpath, peers] of Object.entries(entries)) {
			for (const peer of peers) {
				const used = rows.some(
					(row) =>
						row.name === name &&
						row.subpath === subpath &&
						row.peer === peer &&
						row.mode !== 'guarded',
				);
				if (!used) stale.push(`${name} ${subpath} -> ${peer}`);
			}
		}
	}

	return { rows, unbuilt, stale };
}

const START = '<!-- optional-peers:start -->';
const END = '<!-- optional-peers:end -->';

/** The README section that says which entries need which optional peers. */
function docsSection(name, rows) {
	const pkg = packages.get(name);
	const optional = [...optionalPeers(pkg.manifest)].sort();
	const needs = new Map();
	for (const row of rows) {
		if (row.name !== name || !row.adaptor || row.mode === 'guarded') continue;
		const entry = row.subpath === '.' ? name : `${name}${row.subpath.slice(1)}`;
		needs.set(entry, [...(needs.get(entry) ?? []), row.peer]);
	}
	const named = new Set([...needs.values()].flat());
	const others = optional.filter((peer) => !named.has(peer));
	const code = (list) => list.map((item) => `\`${item}\``).join(', ');

	const lines = [
		START,
		'',
		'<!-- Generated by `node scripts/check-optional-peers.mjs --write-docs`; CI fails when it drifts. -->',
		'',
	];
	if (needs.size > 0) {
		lines.push(
			'Each of these entries imports an optional peer when it loads, so using it means installing that peer:',
			'',
			'| Entry | Install |',
			'| --- | --- |',
		);
		for (const [entry, peers] of [...needs].sort(([a], [b]) =>
			a.localeCompare(b),
		)) {
			lines.push(`| \`${entry}\` | ${code([...new Set(peers)].sort())} |`);
		}
		lines.push('');
	}
	if (others.length > 0) {
		lines.push(
			`${needs.size > 0 ? 'No other entry imports an optional peer when it loads. ' : 'No entry imports an optional peer when it loads. '}` +
				`${code(others)} ${others.length === 1 ? 'is' : 'are'} loaded only when a feature that uses ${others.length === 1 ? 'it' : 'one'} runs ` +
				'(an `import()` inside a `try`, whose error names the package to install), or named only in types.',
			'',
		);
	}
	const source = sourceEntries(pkg).map((subpath) =>
		subpath === '.' ? name : `${name}${subpath.slice(1)}`,
	);
	if (source.length > 0) {
		lines.push(
			`${code(source)} ${source.length === 1 ? 'ships' : 'ship'} as TypeScript source for SST's loader, which provides the \`@pulumi/*\` packages, so ${source.length === 1 ? 'it is' : 'they are'} not covered by the statement above.`,
			'',
		);
	}
	lines.push(END);
	return lines.join('\n');
}

/** Every package README whose optional-peers section is not what it says. */
function docs(rows, write) {
	const drift = [];
	for (const [name, pkg] of packages) {
		if (optionalPeers(pkg.manifest).size === 0) continue;
		const path = join(pkg.dir, 'README.md');
		const text = existsSync(path) ? readFileSync(path, 'utf-8') : `# ${name}\n`;
		const section = docsSection(name, rows);
		let next;
		if (text.includes(START) && text.includes(END)) {
			next =
				text.slice(0, text.indexOf(START)) +
				section +
				text.slice(text.indexOf(END) + END.length);
		} else {
			const heading = `## Optional peers\n\n${section}\n\n`;
			const license = text.search(/^## License/m);
			next =
				license === -1
					? `${text.trimEnd()}\n\n${heading.trimEnd()}\n`
					: text.slice(0, license) + heading + text.slice(license);
		}
		if (next === text) continue;
		drift.push(relative(root, path));
		if (write) writeFileSync(path, next);
	}
	return drift;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { rows, unbuilt, stale } = audit();

	if (process.argv.includes('--write-docs')) {
		const written = docs(rows, true);
		console.log(
			written.length > 0
				? `Wrote the optional-peers section of ${written.join(', ')}.`
				: 'Every optional-peers section is current.',
		);
		process.exit(0);
	}

	if (report) {
		for (const row of rows) {
			const entry = `${row.name}${row.subpath === '.' ? '' : row.subpath.slice(1)}`;
			const verdict = !row.ok ? 'FAULT' : row.adaptor ? 'adaptor' : 'lazy';
			console.log(
				`${verdict.padEnd(8)} ${entry}  ->  ${row.peer}  (${row.mode})`,
			);
		}
		console.log('');
	}

	if (unbuilt.length > 0) {
		console.error('Entries with no built file (run `pnpm build` first):\n');
		for (const line of unbuilt) console.error(`  ${line}`);
		process.exit(1);
	}

	const faults = rows.filter((row) => !row.ok);
	if (faults.length > 0) {
		console.error(
			`${faults.length} entr${faults.length === 1 ? 'y reaches' : 'ies reach'} an optional peer it is not the adaptor for:\n`,
		);
		for (const { name, subpath, peer, mode, condition, via } of faults) {
			console.error(`  ${name} ${subpath} -> ${peer} (${mode}, ${condition})`);
			console.error(`      via ${via.join(' > ')}`);
		}
		console.error(
			'\nAn optional peer is loaded only by the entry that exists to need it,\n' +
				'or by an `import()` inside a `try` that names what to install.\n' +
				'Move the import behind that subpath, guard it, make the peer a\n' +
				'dependency if every user needs it, or, when this entry *is* its\n' +
				'adaptor, add it to ALLOWED in scripts/check-optional-peers.mjs.\n',
		);
		process.exit(1);
	}

	if (stale.length > 0) {
		console.error(
			'ALLOWED in scripts/check-optional-peers.mjs lets entries import optional peers they no longer reach:\n',
		);
		for (const line of stale) console.error(`  ${line}`);
		console.error('\nRemove them, so the list says what each entry needs.\n');
		process.exit(1);
	}

	const drift = docs(rows, false);
	if (drift.length > 0) {
		console.error(
			`The optional-peers section of ${drift.join(', ')} no longer says what the entries import.\n` +
				'Run `node scripts/check-optional-peers.mjs --write-docs` and commit the result.\n',
		);
		process.exit(1);
	}

	const adaptors = rows.filter((row) => row.adaptor).length;
	console.log(
		`Every optional peer is reached only from its adaptor or a guarded import() (${adaptors} from an adaptor, ${rows.length - adaptors} guarded).`,
	);
}
