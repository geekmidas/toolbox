import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
	detectPackageManager,
	findWorkspacePackages,
	type PackageManager,
} from '../init/utils.js';

const logger = console;

export interface UpgradeOptions {
	dryRun?: boolean;
}

interface FoundDependency {
	packageName: string;
	currentVersion: string;
	depType: 'dependencies' | 'devDependencies' | 'peerDependencies';
	packageJsonPath: string;
	workspaceName: string;
}

interface UpgradeInfo extends FoundDependency {
	latestVersion: string;
	isWorkspaceRef: boolean;
	needsUpgrade: boolean;
}

export async function upgradeCommand(
	options: UpgradeOptions = {},
): Promise<void> {
	const cwd = process.cwd();

	logger.log('\n📦 Scanning workspace for @geekmidas packages...\n');

	const pm = detectPackageManager(cwd);
	logger.log(`  Package manager: ${pm}`);

	const packageJsonPaths = findWorkspacePackages(cwd, pm);
	logger.log(`  Found ${packageJsonPaths.length} package(s) in workspace\n`);

	const dependencies = scanForGeekmidasDeps(packageJsonPaths);

	if (dependencies.length === 0) {
		logger.log('  No @geekmidas packages found.\n');
		return;
	}

	const uniquePackages = [...new Set(dependencies.map((d) => d.packageName))];
	logger.log(
		`  Checking ${uniquePackages.length} unique @geekmidas package(s) on npm...\n`,
	);

	const latestVersions = await fetchLatestVersions(uniquePackages);

	const upgradeInfos = dependencies.map((dep) =>
		resolveUpgradeInfo(dep, latestVersions),
	);

	printUpgradeTable(upgradeInfos);

	const upgradable = upgradeInfos.filter(
		(info) => info.needsUpgrade && !info.isWorkspaceRef,
	);

	if (upgradable.length === 0) {
		logger.log('\n  All @geekmidas packages are up to date!\n');
		return;
	}

	logger.log(`\n  ${upgradable.length} package(s) can be upgraded.\n`);

	if (options.dryRun) {
		logger.log('  --dry-run: No changes made.\n');
		printUpgradeCommands(upgradable, pm);
		return;
	}

	executeUpgrade(upgradable, pm, cwd);

	logger.log('\n  ✅ Upgrade complete! Run your tests to verify.\n');
}

function scanForGeekmidasDeps(packageJsonPaths: string[]): FoundDependency[] {
	const results: FoundDependency[] = [];
	const depTypes = [
		'dependencies',
		'devDependencies',
		'peerDependencies',
	] as const;

	for (const pkgJsonPath of packageJsonPaths) {
		const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
		const workspaceName = pkg.name ?? pkgJsonPath;

		for (const depType of depTypes) {
			const deps = pkg[depType];
			if (!deps) continue;

			for (const [name, version] of Object.entries(deps)) {
				if (!name.startsWith('@geekmidas/')) continue;

				results.push({
					packageName: name,
					currentVersion: version as string,
					depType,
					packageJsonPath: pkgJsonPath,
					workspaceName,
				});
			}
		}
	}

	return results;
}

async function fetchLatestVersions(
	packageNames: string[],
): Promise<Map<string, string>> {
	const versions = new Map<string, string>();

	const results = await Promise.allSettled(
		packageNames.map(async (name) => {
			const res = await fetch(`https://registry.npmjs.org/${name}/latest`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { version: string };
			return { name, version: data.version };
		}),
	);

	for (const result of results) {
		if (result.status === 'fulfilled') {
			versions.set(result.value.name, result.value.version);
		}
	}

	return versions;
}

function resolveUpgradeInfo(
	dep: FoundDependency,
	latestVersions: Map<string, string>,
): UpgradeInfo {
	const isWorkspaceRef = dep.currentVersion.startsWith('workspace:');
	const latestVersion = latestVersions.get(dep.packageName) ?? 'unknown';

	const currentBare = dep.currentVersion.replace(/^[\^~>=<]*/g, '');
	const needsUpgrade =
		!isWorkspaceRef &&
		latestVersion !== 'unknown' &&
		currentBare !== latestVersion;

	return {
		...dep,
		latestVersion,
		isWorkspaceRef,
		needsUpgrade,
	};
}

function printUpgradeTable(infos: UpgradeInfo[]): void {
	const byPackage = new Map<string, UpgradeInfo>();
	for (const info of infos) {
		if (!byPackage.has(info.packageName)) {
			byPackage.set(info.packageName, info);
		}
	}

	const nameWidth = 33;
	const verWidth = 14;
	const statusWidth = 14;

	const hr = `  ${'─'.repeat(nameWidth + verWidth * 2 + statusWidth + 5)}`;

	logger.log(hr);
	logger.log(
		`  ${'Package'.padEnd(nameWidth)} ${'Current'.padEnd(verWidth)} ${'Latest'.padEnd(verWidth)} ${'Status'.padEnd(statusWidth)}`,
	);
	logger.log(hr);

	for (const [, info] of byPackage) {
		const name = info.packageName.padEnd(nameWidth);
		const current = info.currentVersion.padEnd(verWidth);
		const latest = info.latestVersion.padEnd(verWidth);

		let status: string;
		if (info.isWorkspaceRef) {
			status = 'workspace';
		} else if (info.needsUpgrade) {
			status = '⬆ upgrade';
		} else {
			status = '✓ up-to-date';
		}

		logger.log(`  ${name} ${current} ${latest} ${status}`);
	}

	logger.log(hr);
}

function printUpgradeCommands(
	upgradable: UpgradeInfo[],
	pm: PackageManager,
): void {
	logger.log('  Commands that would be run:\n');

	const uniquePackages = [...new Set(upgradable.map((i) => i.packageName))];
	const cmd = getWorkspaceUpgradeCommand(pm, uniquePackages);
	logger.log(`    ${cmd}\n`);
}

function getWorkspaceUpgradeCommand(
	pm: PackageManager,
	packages: string[],
): string {
	const pkgList = packages.join(' ');

	switch (pm) {
		case 'pnpm':
			return `pnpm update -r ${pkgList} --latest`;
		case 'yarn':
			return `yarn upgrade ${pkgList}`;
		case 'bun':
			return `bun update ${pkgList}`;
		case 'npm':
			return `npm update ${pkgList} --workspaces`;
		default:
			return `npm update ${pkgList}`;
	}
}

function executeUpgrade(
	upgradable: UpgradeInfo[],
	pm: PackageManager,
	cwd: string,
): void {
	const uniquePackages = [...new Set(upgradable.map((i) => i.packageName))];

	const cmd = getWorkspaceUpgradeCommand(pm, uniquePackages);
	logger.log(`  Running: ${cmd}\n`);

	try {
		execSync(cmd, {
			cwd,
			stdio: 'inherit',
			timeout: 120_000,
		});
	} catch {
		throw new Error(
			'Package upgrade failed. Check the output above for details.',
		);
	}
}
