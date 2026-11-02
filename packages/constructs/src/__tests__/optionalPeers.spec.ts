import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..');

/**
 * The specifiers a module loads when it is evaluated: its value imports and
 * re-exports. `import type`/`export type` are erased, and a dynamic
 * `import()` loads only when it runs, so neither counts.
 */
function staticImports(file: string): string[] {
	const source = readFileSync(file, 'utf-8');
	const found: string[] = [];
	const pattern =
		/^\s*(import|export)\s+(?!type\b)(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
	for (const match of source.matchAll(pattern)) {
		if (match[1] === 'export' && !/\sfrom\s/.test(match[0])) continue;
		found.push(match[2]!);
	}
	return found;
}

function resolveLocal(from: string, specifier: string): string | undefined {
	const base = resolve(dirname(from), specifier);
	for (const candidate of [
		`${base}.ts`,
		join(base, 'index.ts'),
		base.replace(/\.js$/, '.ts'),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** Every package an entry loads, following its relative imports. */
function packagesLoadedBy(entry: string): Set<string> {
	const seen = new Set<string>();
	const packages = new Set<string>();
	const visit = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		for (const specifier of staticImports(file)) {
			if (specifier.startsWith('.')) {
				const local = resolveLocal(file, specifier);
				if (local) visit(local);
				continue;
			}
			packages.add(specifier);
		}
	};
	visit(entry);
	return packages;
}

describe('optional peers', () => {
	it('a Worker loads no part of @geekmidas/emailkit until it receives mail', () => {
		const loaded = [...packagesLoadedBy(join(SRC, 'worker.ts'))];

		expect(
			loaded.filter((specifier) => specifier.startsWith('@geekmidas/emailkit')),
		).toEqual([]);
	});

	it('the test harness loads no emailkit, cache or audit for an app without them', () => {
		const loaded = [
			...packagesLoadedBy(join(SRC, 'adaptors', 'testing.ts')),
		].filter((specifier) =>
			/^@geekmidas\/(emailkit|cache|audit)(\/|$)/.test(specifier),
		);

		expect(loaded).toEqual([]);
	});

	it('sees a value import, so the checks above can fail', () => {
		const loaded = packagesLoadedBy(join(SRC, 'inbox.ts'));

		expect(loaded).toContain('@geekmidas/emailkit/inbound');
	});
});
