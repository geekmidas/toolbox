import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import {
	detectPackageManager,
	findWorkspacePackages,
	findWorkspaceRoot,
	getInstallCommand,
	type PackageManager,
} from '../init/utils.js';
import { compareVersions, prereleaseTag, simpleRange } from './version.js';

const logger = console;

const SCOPE = '@geekmidas/';
const DEP_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
] as const;
type DepField = (typeof DEP_FIELDS)[number];

export interface UpgradeOptions {
	dryRun?: boolean;
	/**
	 * Every `@geekmidas` package, and the third-party packages their peer ranges
	 * require. Without it only `@geekmidas/cli` moves — upgrade the CLI first,
	 * then let the new one run `upgrade --all`, since it is the one that knows
	 * what the new versions need.
	 */
	all?: boolean;
	/** The npm dist-tag to follow. Default: the line the project is on. */
	tag?: string;
}

/** One dependency range, and where it is written. */
interface Occurrence {
	name: string;
	range: string;
	/** A package.json path, or `catalog` for pnpm-workspace.yaml. */
	file: string;
	field: DepField | 'catalog';
	/** For a named pnpm catalog. */
	catalog?: string;
}

interface Change extends Occurrence {
	next: string;
}

/** The abbreviated npm document: dist-tags, and each version's peers. */
interface Packument {
	'dist-tags': Record<string, string>;
	versions: Record<
		string,
		{ peerDependencies?: Record<string, string> } | undefined
	>;
}

async function packument(name: string): Promise<Packument> {
	const res = await fetch(
		`https://registry.npmjs.org/${name.replace('/', '%2F')}`,
		{ headers: { accept: 'application/vnd.npm.install-v1+json' } },
	);
	if (!res.ok) throw new RegistryUnavailable(name, res.status);
	return (await res.json()) as Packument;
}

/** Every registry range in the workspace's package.json files. */
function packageOccurrences(paths: string[]): Occurrence[] {
	const found: Occurrence[] = [];
	for (const file of paths) {
		const pkg = JSON.parse(readFileSync(file, 'utf-8'));
		for (const field of DEP_FIELDS) {
			for (const [name, range] of Object.entries(pkg[field] ?? {})) {
				found.push({ name, range: range as string, file, field });
			}
		}
	}
	return found;
}

/** pnpm catalog entries, which is where `catalog:` references resolve. */
function catalogOccurrences(root: string): Occurrence[] {
	const file = join(root, 'pnpm-workspace.yaml');
	if (!existsSync(file)) return [];

	const doc = parseDocument(readFileSync(file, 'utf-8')).toJS() ?? {};
	const found: Occurrence[] = [];
	for (const [name, range] of Object.entries(doc.catalog ?? {})) {
		found.push({ name, range: String(range), file, field: 'catalog' });
	}
	for (const [catalog, entries] of Object.entries(doc.catalogs ?? {})) {
		for (const [name, range] of Object.entries(entries ?? {})) {
			found.push({
				name,
				range: String(range),
				file,
				field: 'catalog',
				catalog,
			});
		}
	}
	return found;
}

/** Not a registry range: resolved elsewhere, so not ours to move. */
const isIndirect = (range: string) =>
	/^(workspace|catalog|link|file|npm|git|github|https?):/.test(range);

/**
 * The version every `@geekmidas` package moves to.
 *
 * All of them share one version, so the CLI's line answers for the rest. The
 * tag is the one the project is already on — a project on `10.0.0-alpha.6`
 * follows `alpha` — because `latest` names a different major while a new one
 * is in prerelease, and following it would move the project backwards.
 */
export function resolveTarget(
	distTags: Record<string, string>,
	installed: string[],
	tag?: string,
): { tag: string; version: string } {
	const highest = [...installed].sort(compareVersions).at(-1);
	const chosen = tag ?? (highest && prereleaseTag(highest)) ?? 'latest';
	const version = distTags[chosen];
	if (!version) {
		throw new NoReleaseOnTag(chosen, Object.keys(distTags));
	}
	return { tag: chosen, version };
}

/** The same operator on the new version — `^`, `~`, `>=` or none, as written. */
function withVersion(range: string, version: string): string {
	return `${simpleRange(range)?.operator ?? ''}${version}`;
}

export async function upgradeCommand(
	options: UpgradeOptions = {},
): Promise<void> {
	const cwd = process.cwd();
	const pm = detectPackageManager(cwd);
	const root = findWorkspaceRoot(cwd, pm);

	logger.log('\n📦 Scanning workspace for @geekmidas packages...\n');
	logger.log(`  Package manager: ${pm}`);

	const packageJsons = findWorkspacePackages(cwd, pm);
	const occurrences = [
		...packageOccurrences(packageJsons),
		...catalogOccurrences(root),
	];
	logger.log(`  Found ${packageJsons.length} package(s) in workspace\n`);

	const ours = occurrences.filter(
		(o) => o.name.startsWith(SCOPE) && !isIndirect(o.range),
	);
	if (ours.length === 0) {
		logger.log('  No @geekmidas packages found.\n');
		return;
	}

	const installed = ours
		.map((o) => simpleRange(o.range)?.version)
		.filter((v): v is string => Boolean(v));

	const cli = await packument(`${SCOPE}cli`);
	const target = resolveTarget(cli['dist-tags'], installed, options.tag);
	logger.log(`  Target: ${target.version} (npm "${target.tag}")\n`);

	// Never backwards: a project ahead of the tag it follows keeps its version.
	const highest = installed.sort(compareVersions).at(-1)!;
	if (compareVersions(target.version, highest) < 0) {
		throw new WouldDowngrade(highest, target.tag, target.version);
	}

	const moving = options.all
		? ours
		: ours.filter((o) => o.name === `${SCOPE}cli`);

	const changes: Change[] = [];
	for (const o of moving) {
		// A range like `>=8 <10` says something on purpose; it is reported for a
		// person to widen rather than flattened to one version.
		if (!simpleRange(o.range)) {
			logger.log(
				`  ⚠ ${o.name} ${o.range} is not a simple range; left as is (target ${target.version}).`,
			);
			continue;
		}
		const next = withVersion(o.range, target.version);
		if (next !== o.range) changes.push({ ...o, next });
	}

	if (options.all) {
		changes.push(...(await peerChanges(occurrences, ours, target.version)));
	}

	if (changes.length === 0) {
		logger.log('  Everything is already on the target version.\n');
		return;
	}

	printChanges(changes, root);

	if (!options.all && ours.some((o) => o.name !== `${SCOPE}cli`)) {
		logger.log(
			'\n  Only @geekmidas/cli moves without --all. Afterwards, run `gkm upgrade --all` with the new CLI.',
		);
	}

	if (options.dryRun) {
		logger.log('\n  --dry-run: no changes made.\n');
		return;
	}

	applyChanges(changes);
	install(pm, root);
	logger.log('\n  ✅ Upgrade complete. Run your tests to verify.\n');
}

/**
 * Third-party packages the project already lists, raised to the floor of the
 * peer range the target `@geekmidas` versions declare.
 *
 * Only raised, never lowered, and only where both the peer range and the
 * project's range are one operator and one version; anything else is reported
 * for a person to decide.
 */
async function peerChanges(
	occurrences: Occurrence[],
	ours: Occurrence[],
	version: string,
): Promise<Change[]> {
	const floors = new Map<string, string>();
	const names = [...new Set(ours.map((o) => o.name))];
	const docs = await Promise.all(names.map(packument));

	for (const doc of docs) {
		const peers = doc.versions[version]?.peerDependencies ?? {};
		for (const [peer, range] of Object.entries(peers)) {
			if (peer.startsWith(SCOPE)) continue;
			const floor = simpleRange(range)?.version;
			if (!floor) continue;
			const known = floors.get(peer);
			if (!known || compareVersions(floor, known) > 0) floors.set(peer, floor);
		}
	}

	const changes: Change[] = [];
	for (const o of occurrences) {
		const floor = floors.get(o.name);
		if (!floor || isIndirect(o.range) || o.field === 'peerDependencies') {
			continue;
		}
		const current = simpleRange(o.range);
		if (!current) {
			logger.log(
				`  ⚠ ${o.name} ${o.range} is not a simple range; @geekmidas needs at least ${floor}.`,
			);
			continue;
		}
		if (compareVersions(current.version, floor) < 0) {
			changes.push({ ...o, next: withVersion(o.range, floor) });
		}
	}
	return changes;
}

function printChanges(changes: Change[], root: string): void {
	logger.log('  Changes:\n');
	for (const c of changes) {
		const where =
			c.field === 'catalog'
				? `pnpm-workspace.yaml (${c.catalog ? `catalogs.${c.catalog}` : 'catalog'})`
				: `${relative(root, c.file) || 'package.json'} (${c.field})`;
		logger.log(`  ${c.name.padEnd(34)} ${c.range} → ${c.next}   ${where}`);
	}
}

function applyChanges(changes: Change[]): void {
	const byFile = new Map<string, Change[]>();
	for (const c of changes) {
		byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
	}

	for (const [file, fileChanges] of byFile) {
		const text = readFileSync(file, 'utf-8');
		if (file.endsWith('.yaml')) {
			// Through the document, so comments and layout survive.
			const doc = parseDocument(text);
			for (const c of fileChanges) {
				const path = c.catalog
					? ['catalogs', c.catalog, c.name]
					: ['catalog', c.name];
				doc.setIn(path, c.next);
			}
			writeFileSync(file, doc.toString());
			continue;
		}

		const pkg = JSON.parse(text);
		for (const c of fileChanges) pkg[c.field][c.name] = c.next;
		const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
		writeFileSync(file, `${JSON.stringify(pkg, null, indent)}\n`);
	}
}

function install(pm: PackageManager, cwd: string): void {
	const command = getInstallCommand(pm);
	logger.log(`\n  Running: ${command}\n`);
	try {
		execSync(command, { cwd, stdio: 'inherit', timeout: 300_000 });
	} catch {
		throw new InstallFailed(command);
	}
}

/** npm did not answer for a package, so there is no version to compare. */
export class RegistryUnavailable extends Error {
	constructor(
		readonly name: string,
		readonly status: number,
	) {
		super(
			`npm answered ${status} for ${name}. Check the name and your network.`,
		);
		this.name = 'RegistryUnavailable';
	}
}

/** A dist-tag npm does not have, e.g. `--tag beta` before any beta. */
export class NoReleaseOnTag extends Error {
	constructor(
		readonly tag: string,
		readonly tags: readonly string[],
	) {
		super(
			`npm has no "${tag}" release of @geekmidas/cli. Tags: ${tags.join(', ')}.`,
		);
		this.name = 'NoReleaseOnTag';
	}
}

/** The line asked for is behind what is installed; upgrade never goes back. */
export class WouldDowngrade extends Error {
	constructor(
		readonly installed: string,
		readonly tag: string,
		readonly target: string,
	) {
		super(
			`The project is already on ${installed}, ahead of npm's "${tag}" (${target}). Pass --tag to follow another line.`,
		);
		this.name = 'WouldDowngrade';
	}
}

/** The install after rewriting versions failed; its own output says why. */
export class InstallFailed extends Error {
	constructor(readonly command: string) {
		super(`\`${command}\` failed. Check the output above for details.`);
		this.name = 'InstallFailed';
	}
}
