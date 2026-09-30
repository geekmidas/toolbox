import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { loadWorkspaceConfig } from '../config';
import {
	createCredentialsPreload,
	loadEnvFiles,
	prepareEntryCredentials,
} from '../credentials';
import { sniffAppEnvironment } from '../deploy/sniffer';
import { backendsOf, constructGlobs } from '../reconcile/workspace.js';
import { TEST_STAGE } from '../workspace/stages';
import { TEST_MANIFEST_ENV, writeTestHarness } from './harness';

export interface TestOptions {
	/** Stage to load secrets from (default: development) */
	stage?: string;
	/** Run tests once without watch mode */
	run?: boolean;
	/** Enable watch mode */
	watch?: boolean;
	/** Generate coverage report */
	coverage?: boolean;
	/** Open Vitest UI */
	ui?: boolean;
	/** Pattern to filter tests */
	pattern?: string;
	/**
	 * Generate a fresh stage (secrets + encryption key) from the workspace config
	 * when none exists, instead of requiring committed secrets / a shared key.
	 * Intended for CI. Also enabled by the GKM_AUTO_SETUP env var.
	 */
	autoSetup?: boolean;
	/**
	 * Write the test manifest and the harness generated from it, then stop —
	 * no containers started, no suite run. What typechecking a suite needs:
	 * `#test` is generated, so a typecheck that runs before `gkm test` has
	 * nothing to resolve it to without this.
	 */
	prepare?: boolean;
}

/**
 * Run tests with secrets, dependency URLs, and .env files loaded.
 * Environment variables are sniffed to inject only what the app needs.
 */
export async function testCommand(options: TestOptions = {}): Promise<void> {
	const cwd = process.cwd();
	// The project's local stage unless one was named: \`gkm test\` reads the
	// secrets a developer's own \`gkm dev\` does.
	const stage =
		options.stage ??
		(await loadWorkspaceConfig(cwd)
			.then((loaded) => loaded.workspace.stages.local)
			.catch(() => undefined));
	if (!stage) {
		throw new NoStageToTest();
	}

	console.log(`\n🧪 Running tests with ${stage} environment...\n`);

	// 0. Auto-setup (CI): regenerate a fresh stage from the workspace config when
	//    none exists, so tests run without committed secrets or a shared key.
	const autoSetup = options.autoSetup || Boolean(process.env.GKM_AUTO_SETUP);
	if (autoSetup) {
		const { ensureStageSecrets } = await import('../setup/index.js');
		const generated = await ensureStageSecrets(stage, cwd);
		if (generated) {
			console.log(`  🔐 Generated fresh ${stage} secrets (auto-setup)`);
		}
	}

	// 1. Load .env files
	const defaultEnv = loadEnvFiles('.env');
	if (defaultEnv.loaded.length > 0) {
		console.log(`  📦 Loaded env: ${defaultEnv.loaded.join(', ')}`);
	}

	// 2. Prepare credentials: loads secrets and reconciles the test stage —
	//    starts its containers and resolves every declared address
	const result = await prepareEntryCredentials({
		stage,
		// Preparing writes files; it has no suite to start containers for.
		startDocker: !options.prepare,
		secretsFileName: 'test-secrets.json',
		// The same reconcile `gkm dev` runs, differing only in what the resources
		// are called: one container and one role pair serve both stages, so the
		// suffix is the whole of the isolation.
		reconcileStage: 'test',
	});

	let finalCredentials = { ...result.credentials };

	// 3. Sniff env vars to filter only what the app needs (workspace only)
	if (result.appInfo) {
		const sniffed = await sniffAppEnvironment(
			result.appInfo.app,
			result.appInfo.appName,
			result.appInfo.workspaceRoot,
			{ logWarnings: false },
		);

		if (sniffed.requiredEnvVars.length > 0) {
			// Sniffed *plus* declared. A construct reads its own key inside
			// `@geekmidas/constructs` rather than in application code, so a walk of
			// the app finds no `get('MAIL_URL')` and sniffing alone reports it as
			// unneeded — which is how a suite that resolved 25 declared URLs
			// started with 13 and failed on the first construct to look for one of
			// the other 12.
			const needed = new Set([
				...sniffed.requiredEnvVars,
				...result.declaredKeys,
			]);
			const filtered: Record<string, string> = {};
			for (const [key, value] of Object.entries(finalCredentials)) {
				if (needed.has(key)) {
					filtered[key] = value;
				}
			}
			finalCredentials = filtered;
			console.log(
				`  🔍 Sniffed ${sniffed.requiredEnvVars.length} required env var(s)` +
					(result.declaredKeys.length > 0
						? `, kept ${result.declaredKeys.length} declared`
						: ''),
			);
		}
	}

	console.log('');

	// 4. Write final credentials and create preload script
	await writeFile(
		result.secretsJsonPath,
		JSON.stringify(finalCredentials, null, 2),
	);

	const gkmDir = join(cwd, '.gkm');
	const preloadPath = join(gkmDir, 'test-credentials-preload.ts');
	await createCredentialsPreload(preloadPath, result.secretsJsonPath);

	// 5. The test manifest: what was discovered and resolved above, kept for the
	//    suite, so a feature test is built from it rather than declaring it all
	//    again — and the harness generated from it, `it` and a `Browser` with a
	//    typed client per surface.
	const workspace = await loadWorkspaceConfig(cwd)
		.then((loaded) => loaded.workspace)
		.catch(() => undefined);
	const manifestPath = workspace
		? await writeTestHarness({
				root: workspace.root,
				targets: [
					workspace.root,
					...Object.values(workspace.apps).map((app) =>
						isAbsolute(app.path) ? app.path : join(workspace.root, app.path),
					),
				],
				patterns: constructGlobs(workspace),
				cacheBackend: backendsOf(workspace).cache,
				stage: TEST_STAGE,
				env: finalCredentials,
			})
		: undefined;

	if (options.prepare) {
		console.log(
			manifestPath
				? `  🧪 Test harness written beside ${manifestPath}`
				: '  🧪 Nothing to prepare: this project declares no constructs',
		);
		return;
	}

	// Merge NODE_OPTIONS with existing value (if any)
	const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
	const tsxImport = '--import=tsx';
	const preloadImport = `--import=${preloadPath}`;
	const nodeOptions = [existingNodeOptions, tsxImport, preloadImport]
		.filter(Boolean)
		.join(' ');

	// Build vitest args
	const args: string[] = [];

	if (options.run) {
		args.push('run');
	} else if (options.watch) {
		args.push('--watch');
	}

	if (options.coverage) {
		args.push('--coverage');
	}

	if (options.ui) {
		args.push('--ui');
	}

	if (options.pattern) {
		args.push(options.pattern);
	}

	// Run vitest with combined environment and credentials preload
	const vitestProcess = spawn('npx', ['vitest', ...args], {
		cwd,
		stdio: 'inherit',
		env: {
			...process.env,
			...finalCredentials,
			...(manifestPath ? { [TEST_MANIFEST_ENV]: manifestPath } : {}),
			NODE_ENV: 'test',
			NODE_OPTIONS: nodeOptions,
		},
	});

	// Wait for vitest to complete
	return new Promise((resolve, reject) => {
		vitestProcess.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Tests failed with exit code ${code}`));
			}
		});

		vitestProcess.on('error', (error) => {
			reject(error);
		});
	});
}

/** `gkm test` outside a project that declares stages, with none named. */
export class NoStageToTest extends Error {
	constructor() {
		super(
			'No stage to test with: add `stages` to gkm.config.ts, or pass --stage.',
		);
		this.name = 'NoStageToTest';
	}
}
