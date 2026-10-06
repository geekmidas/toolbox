import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import prompts from 'prompts';
import { FileSecretsStore } from '../secrets/file.js';
import { createStageSecrets } from '../secrets/generator.js';
import { getKeyPath } from '../secrets/keystore.js';
import {
	deployedProblems,
	InvalidStages,
	stageProblems,
} from '../workspace/stages.js';
import type { StagesConfig } from '../workspace/types.js';
import { generateAgentFiles } from './generators/agents.js';
import { generateAuthAppFiles } from './generators/auth.js';
import { generateConfigFiles } from './generators/config.js';
import { generateEnvFiles } from './generators/env.js';
import { generateGithubFiles } from './generators/github.js';
import { generateExpoAppFiles } from './generators/mobile-expo.js';
import { generateModelsPackage } from './generators/models.js';
import {
	generateMonorepoFiles,
	generateRootConstructs,
} from './generators/monorepo.js';
import { generatePackageJson } from './generators/package.js';
import { generateSourceFiles } from './generators/source.js';
import {
	generateTestFactoryFiles,
	generateTestFiles,
} from './generators/test.js';
import { generateWebAppFiles } from './generators/web.js';
import { generateTanStackWebFiles } from './generators/web-tanstack.js';
import {
	constructChoices,
	type DeployTarget,
	deployTargetChoices,
	type FullstackFrontendFramework,
	frontendFrameworkChoices,
	getTemplate,
	isFullstackTemplate,
	loggerTypeChoices,
	type PackageManager,
	packageManagerChoices,
	routesStructureChoices,
	type TemplateName,
	type TemplateOptions,
	templateChoices,
} from './templates/index.js';
import {
	checkDirectoryExists,
	detectPackageManager,
	getExecCommand,
	getInstallCommand,
	getRunCommand,
	validateProjectName,
} from './utils.js';

export interface InitOptions {
	/** Project name */
	name?: string;
	/** Template to use */
	template?: TemplateName;
	/** Skip dependency installation */
	skipInstall?: boolean;
	/** Use defaults for all prompts */
	yes?: boolean;
	/** Force monorepo setup (deprecated, use fullstack template) */
	monorepo?: boolean;
	/** API app path in monorepo */
	apiPath?: string;
	/** Package manager to use */
	pm?: PackageManager;
	/** Where the project deploys: `dokploy`, `sst`, or `none` */
	deploy?: DeployTarget;
	/** The AWS region an SST deploy goes to, e.g. `eu-west-1` */
	region?: string;
	/** Deployed stage names, comma-separated, e.g. `staging,prod` */
	stages?: string;
	/** Which deployed stage is production: retained and protected */
	protectedStage?: string;
	/** What `gkm dev`, `exec` and `test` run as, e.g. `dev` */
	localStage?: string;
}

/** `' staging, prod '` → `['staging', 'prod']`. */
const stageList = (value: string): string[] =>
	value
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean);

/** `eu-west-1`, `us-gov-west-1`, `ap-southeast-2`. */
const AWS_REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

/**
 * Main init command - scaffolds a new project
 */
export async function initCommand(
	projectName?: string,
	options: InitOptions = {},
): Promise<void> {
	const cwd = process.cwd();
	const detectedPkgManager = detectPackageManager(cwd);

	if (
		options.deploy &&
		!deployTargetChoices.some((choice) => choice.value === options.deploy)
	) {
		throw new UnknownDeployTarget(
			options.deploy,
			deployTargetChoices.map((c) => c.value),
		);
	}

	if (options.region && !AWS_REGION.test(options.region)) {
		throw new NotAnAwsRegion(options.region);
	}

	// Flags are checked before anything is asked or written, the same rules
	// gkm.config.ts is held to.
	if (options.stages || options.localStage || options.protectedStage) {
		const deployed = stageList(options.stages ?? '');
		const problems = [
			...deployedProblems(deployed),
			...(options.localStage
				? stageProblems({ local: options.localStage, deployed })
				: []),
			...(options.protectedStage && !deployed.includes(options.protectedStage)
				? [`--protected-stage "${options.protectedStage}" is not in --stages`]
				: []),
		];
		if (problems.length) throw new InvalidStages([...new Set(problems)]);
	}

	let deployedSoFar: string[] = [];

	// Handle Ctrl+C gracefully
	prompts.override({});
	const onCancel = () => {
		process.exit(0);
	};

	// Gather answers via prompts
	const answers = await prompts(
		[
			{
				type: projectName || options.name ? null : 'text',
				name: 'name',
				message: 'Project name:',
				initial: 'my-app',
				validate: (value: string) => {
					const nameValid = validateProjectName(value);
					if (nameValid !== true) return nameValid;
					const dirValid = checkDirectoryExists(value, cwd);
					if (dirValid !== true) return dirValid;
					return true;
				},
			},
			{
				type: options.template || options.yes ? null : 'select',
				name: 'template',
				message: 'Template:',
				choices: templateChoices,
				initial: 0,
			},
			{
				type: options.yes ? null : 'multiselect',
				name: 'constructs',
				message: 'Constructs to declare (space to select, enter to confirm):',
				choices: constructChoices.map((c) => ({ ...c, selected: true })),
				hint: '- Space to select. Return to submit',
			},
			{
				type: options.yes ? null : 'select',
				name: 'packageManager',
				message: 'Package manager:',
				choices: packageManagerChoices,
				initial: packageManagerChoices.findIndex(
					(c) => c.value === detectedPkgManager,
				),
			},
			{
				type: options.yes || options.deploy ? null : 'select',
				name: 'deployTarget',
				message: 'Deployment target:',
				choices: deployTargetChoices,
				initial: 0,
			},
			{
				type: (_prev, values) =>
					!options.yes &&
					!options.region &&
					(options.deploy ?? values.deployTarget) === 'sst'
						? 'text'
						: null,
				name: 'region',
				message: 'AWS region (e.g. eu-west-1):',
				validate: (value: string) =>
					AWS_REGION.test(value.trim()) || 'An AWS region, like eu-west-1',
			},
			{
				// Named by the project, not picked from a list: whatever the team
				// already calls its environments.
				type: options.yes || options.stages ? null : 'text',
				name: 'deployedStages',
				message: 'Deployed stages, comma-separated (e.g. staging, prod):',
				validate: (value: string) => {
					const deployed = stageList(value);
					if (deployed.length === 0) return 'At least one stage';
					return deployedProblems(deployed)[0] ?? true;
				},
			},
			{
				type: (_prev, values) =>
					options.yes || options.protectedStage
						? null
						: stageList(options.stages ?? values.deployedStages ?? '').length >
								1
							? 'select'
							: null,
				name: 'protectedStage',
				message: 'Which one is production (retained and protected)?',
				choices: (_prev, values) =>
					stageList(options.stages ?? values.deployedStages ?? '').map(
						(name) => ({ title: name, value: name }),
					),
			},
			{
				// \`validate\` is not handed the earlier answers, and the local stage
				// is only valid relative to the deployed ones — so they are read
				// here, where \`type\` is.
				type: (_prev, values) => {
					deployedSoFar = stageList(
						options.stages ?? values.deployedStages ?? '',
					);
					return options.yes || options.localStage ? null : 'text';
				},
				name: 'localStage',
				message: 'Local stage, what gkm dev runs as (e.g. dev):',
				validate: (value: string) =>
					stageProblems({ local: value.trim(), deployed: deployedSoFar })[0] ??
					true,
			},
			{
				type: options.yes ? null : 'confirm',
				name: 'telescope',
				message: 'Include Telescope (request, exception and log recording)?',
				initial: true,
			},
			{
				type: options.yes ? null : 'select',
				name: 'loggerType',
				message: 'Logger:',
				choices: loggerTypeChoices,
				initial: 0,
			},
			{
				type: options.yes ? null : 'select',
				name: 'routesStructure',
				message: 'Routes structure:',
				choices: routesStructureChoices,
				initial: 0,
			},
			{
				// Only prompt for frontend framework on the fullstack template.
				type: (_prev, values) =>
					!options.yes &&
					(options.template === 'fullstack' || values.template === 'fullstack')
						? 'select'
						: null,
				name: 'frontendFramework',
				message: 'Frontend framework:',
				choices: frontendFrameworkChoices,
				initial: 0,
			},
		],
		{ onCancel },
	);

	// Build final options
	const name = projectName || options.name || answers.name;
	if (!name) {
		console.error('Project name is required');
		process.exit(1);
	}

	// Validate name if provided via argument
	if (projectName || options.name) {
		const nameToValidate = projectName || options.name!;
		const nameValid = validateProjectName(nameToValidate);
		if (nameValid !== true) {
			console.error(nameValid);
			process.exit(1);
		}
		const dirValid = checkDirectoryExists(nameToValidate, cwd);
		if (dirValid !== true) {
			console.error(dirValid);
			process.exit(1);
		}
	}

	const template: TemplateName = options.template || answers.template || 'api';
	const isFullstack = isFullstackTemplate(template);

	// For fullstack, force monorepo mode
	// For api template, monorepo is optional (via --monorepo flag)
	const monorepo = isFullstack || options.monorepo || false;

	// Which constructs to declare. Everything that runs them — the containers
	// locally, the backends deployed — is derived from these and the target.
	const chosen: string[] = options.yes
		? constructChoices.map((c) => c.value)
		: answers.constructs || [];
	const constructs = {
		// A fullstack workspace always has a database: its auth server's
		// tenant lives in it.
		database: isFullstack || chosen.includes('database'),
		cache: chosen.includes('cache'),
		uploads: chosen.includes('uploads'),
		mail: chosen.includes('mail'),
	};

	const pkgManager: PackageManager = options.pm
		? options.pm
		: options.yes
			? 'pnpm'
			: (answers.packageManager ?? detectedPkgManager);

	// `--yes` picks no host rather than one: a default that scaffolds one
	// provider's deploy script commits every unattended project to it.
	const deployTarget: DeployTarget =
		options.deploy ?? (options.yes ? 'none' : (answers.deployTarget ?? 'none'));

	const frontendFramework: FullstackFrontendFramework | undefined = isFullstack
		? options.yes
			? 'nextjs'
			: (answers.frontendFramework ?? 'nextjs')
		: undefined;
	const templateOptions: TemplateOptions = {
		name,
		template,
		telescope: options.yes ? true : (answers.telescope ?? true),
		loggerType: options.yes ? 'pino' : (answers.loggerType ?? 'pino'),
		routesStructure: options.yes
			? 'centralized-endpoints'
			: (answers.routesStructure ?? 'centralized-endpoints'),
		monorepo,
		apiPath: monorepo ? (options.apiPath ?? 'apps/api') : '',
		packageManager: pkgManager,
		deployTarget,
		stages: resolveStages(options, answers),
		...(deployTarget === 'sst'
			? {
					// Asked when there is someone to ask; \`--yes\` takes eu-west-1.
					region:
						options.region ??
						(options.yes ? 'eu-west-1' : answers.region?.trim()),
				}
			: {}),
		constructs,
		frontendFramework,
	};

	const targetDir = join(cwd, name);
	const baseTemplate = getTemplate(templateOptions.template);

	const isMonorepo = templateOptions.monorepo;
	const apiPath = templateOptions.apiPath;

	console.log('\n🚀 Creating your project...\n');

	// Create project directory
	await mkdir(targetDir, { recursive: true });

	// For monorepo, app files go in the specified apiPath (e.g., apps/api)
	const appDir = isMonorepo ? join(targetDir, apiPath) : targetDir;
	if (isMonorepo) {
		await mkdir(appDir, { recursive: true });
	}

	// Collect app files (backend/api)
	// Note: Docker files go to root for monorepo, so exclude them here
	const appFiles = baseTemplate
		? [
				...generatePackageJson(templateOptions, baseTemplate),
				...generateConfigFiles(templateOptions, baseTemplate),
				...generateEnvFiles(templateOptions, baseTemplate),
				...generateSourceFiles(templateOptions, baseTemplate),
				...generateTestFiles(templateOptions, baseTemplate),
			]
		: [];

	// Collect root monorepo files (includes packages/models)
	const rootFiles = baseTemplate
		? [
				// At the project root in both layouts: an agent opening the repo
				// reads the root, not the app directory it has not found yet.
				...generateAgentFiles(templateOptions, baseTemplate),
				...generateGithubFiles(templateOptions),
				...generateMonorepoFiles(templateOptions, baseTemplate),
				...generateRootConstructs(templateOptions),
				...generateModelsPackage(templateOptions),
				// The project's, like its migrations: a factory belongs to a
				// database, and every app's tests are handed it.
				...generateTestFactoryFiles(templateOptions),
			]
		: [];

	// Collect frontend app files for fullstack template, dispatched by framework
	const webAppFiles = isFullstack
		? frontendFramework === 'tanstack-start'
			? generateTanStackWebFiles(templateOptions)
			: frontendFramework === 'expo'
				? generateExpoAppFiles(templateOptions)
				: generateWebAppFiles(templateOptions)
		: [];

	// Collect auth app files for fullstack template
	const authAppFiles = isFullstack ? generateAuthAppFiles(templateOptions) : [];

	// Write root files (for monorepo)
	for (const { path, content } of rootFiles) {
		const fullPath = join(targetDir, path);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content);
	}

	// Write app files (backend)
	for (const { path, content } of appFiles) {
		const fullPath = join(appDir, path);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content);
	}

	// Write web app files (frontend)
	for (const { path, content } of webAppFiles) {
		const fullPath = join(targetDir, path);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content);
	}

	// Write auth app files (authentication service)
	for (const { path, content } of authAppFiles) {
		const fullPath = join(targetDir, path);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content);
	}

	// Initialize encrypted secrets for the local stage
	console.log('🔐 Initializing encrypted secrets...\n');
	// No container credentials: the containers are derived from the declared
	// constructs, and reconcile provisions their roles and passwords.
	const local = templateOptions.stages.local;
	const devSecrets = createStageSecrets(local, [], { projectName: name });

	// Add common custom secrets. No `NODE_ENV`: the command decides that, and
	// `gkm exec` injects secrets over the environment — so one stored here made
	// every `gkm exec -- next build` a development build, which Next refuses
	// to prerender.
	const customSecrets: Record<string, string> = {
		PORT: '3000',
		LOG_LEVEL: 'debug',
		JWT_SECRET: `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	};

	if (isFullstack) {
		// Auth service secrets (better-auth)
		customSecrets.AUTH_PORT = '3002';
		customSecrets.AUTH_URL = 'http://localhost:3002'; // For API app to call auth service
		customSecrets.BETTER_AUTH_SECRET = `better-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		customSecrets.BETTER_AUTH_URL = 'http://localhost:3002';
		customSecrets.BETTER_AUTH_TRUSTED_ORIGINS =
			'http://localhost:3000,http://localhost:3001';
	}

	devSecrets.custom = customSecrets;

	// The local stage's store is always the file.
	await new FileSecretsStore(targetDir).write(local, devSecrets);
	const keyPath = getKeyPath(local, name);
	console.log(`  Secrets: .gkm/secrets/${local}.json (encrypted)`);
	console.log(`  Key: ${keyPath}\n`);

	// Install dependencies
	if (!options.skipInstall) {
		console.log('\n📦 Installing dependencies...\n');
		try {
			execSync(getInstallCommand(pkgManager), {
				cwd: targetDir,
				stdio: 'inherit',
			});
		} catch {
			console.error('Failed to install dependencies');
		}

		// The generators write JSON-style double quotes; the project's own
		// biome.json says single. \`check --write\` formats, sorts imports and
		// applies safe fixes. It was \`format --write --unsafe\`, which Biome 2
		// rejects outright — and the error was swallowed, so nothing was ever
		// formatted.
		try {
			execSync(getExecCommand(pkgManager, 'biome check --write .'), {
				cwd: targetDir,
				stdio: 'inherit',
			});
		} catch {
			console.warn(
				`\n⚠️  Formatting did not finish cleanly. Run ${getRunCommand(pkgManager, 'fmt')} to see why.`,
			);
		}
	}

	// Initialize git repository
	console.log('\n📦 Initializing git repository...\n');
	try {
		execSync('git init', { cwd: targetDir, stdio: 'pipe' });
		execSync('git branch -M main', { cwd: targetDir, stdio: 'pipe' });
		execSync('git add .', { cwd: targetDir, stdio: 'pipe' });
		execSync('git commit -m "🎉 Project created with @geekmidas/toolbox"', {
			cwd: targetDir,
			stdio: 'pipe',
		});
		console.log('  Initialized git repository on branch main');
	} catch {
		console.log(
			'  Could not initialize git repository (git may not be installed)',
		);
	}

	// Print success message with next steps
	printNextSteps(name, templateOptions, pkgManager);
}

/**
 * Print success message with next steps
 */
function printNextSteps(
	projectName: string,
	options: TemplateOptions,
	pkgManager: PackageManager,
): void {
	const devCommand = getRunCommand(pkgManager, 'dev');
	const cdCommand = `cd ${projectName}`;

	console.log(`\n${'─'.repeat(50)}`);
	console.log('\n✅ Project created successfully!\n');

	console.log('Next steps:\n');
	console.log(`  ${cdCommand}`);

	// A project that declares its infrastructure starts nothing by hand:
	// `gkm dev` reconciles the containers its constructs imply first.
	console.log(`  ${devCommand}`);

	if (options.constructs.database) {
		console.log('');
		console.log(
			"  # Apply each database construct's db/<construct>/ migrations:",
		);
		console.log('  gkm migrate');
		if (options.monorepo) {
			console.log("  # Better Auth's tables, as its tenant's first migration:");
			console.log('  gkm migration auth && gkm migrate');
		}
	}
	console.log('');

	if (options.monorepo) {
		console.log('📁 Project structure:');
		console.log(`  ${projectName}/`);
		console.log(`  ├── apps/`);
		console.log(`  │   ├── api/          # Backend API`);
		if (isFullstackTemplate(options.template)) {
			console.log(`  │   ├── auth/         # Auth service (better-auth)`);
			switch (options.frontendFramework) {
				case 'tanstack-start':
					console.log(`  │   └── web/          # TanStack Start frontend`);
					break;
				case 'expo':
					console.log(`  │   └── app/          # Expo (React Native) app`);
					break;
				default:
					console.log(`  │   └── web/          # Next.js frontend`);
			}
		}
		console.log(`  ├── packages/`);
		console.log(`  │   └── models/       # Shared Zod schemas`);
		console.log(`  ├── .gkm/secrets/     # Encrypted secrets`);
		console.log(`  ├── gkm.config.ts     # Workspace config`);
		console.log(`  └── turbo.json        # Turbo config`);
		console.log('');
	}

	const { local, deployed } = options.stages;
	console.log('🔐 Secrets management:');
	console.log(`  gkm secrets:show --stage ${local}  # View secrets`);
	console.log(`  gkm secrets:set KEY VALUE --stage ${local}  # Add secret`);
	for (const stage of deployed) {
		console.log(
			`  gkm secrets:init --stage ${stage}  # Create ${stage} secrets`,
		);
	}
	console.log('');

	if (options.deployTarget === 'dokploy') {
		console.log('🚀 Deployment:');
		for (const stage of deployed) {
			console.log(`  ${getRunCommand(pkgManager, `deploy:${stage}`)}`);
		}
		console.log('');
	}

	if (options.deployTarget === 'sst') {
		console.log('🚀 Deployment (AWS, through SST):');
		for (const stage of deployed) {
			console.log(
				`  ${getRunCommand(pkgManager, `deploy:${stage}`)}  # gkm build, then sst deploy`,
			);
		}
		console.log(`  Uses your AWS credentials, in ${options.region}.`);
		if (options.constructs.mail) {
			console.log('  Set MAIL_FROM to a sender verified in SES first.');
		}
		console.log('');
	}

	console.log('📚 Documentation: https://geekmidas.github.io/toolbox/');
	console.log('');
}

/**
 * The stages the project declares, from the answers or the flags.
 *
 * `--yes` with no stage flags has nobody to ask and needs an answer, so it
 * takes `local`, and one deployed stage, `production`, that is protected.
 */
function resolveStages(
	options: InitOptions,
	answers: {
		deployedStages?: string;
		protectedStage?: string;
		localStage?: string;
	},
): StagesConfig {
	const deployed = stageList(
		options.stages ??
			answers.deployedStages ??
			(options.yes ? 'production' : ''),
	);
	const kept =
		options.protectedStage ??
		answers.protectedStage ??
		(deployed.length === 1 || options.yes ? deployed[0] : undefined);
	const local = (
		options.localStage ??
		answers.localStage ??
		(options.yes ? 'local' : '')
	).trim();

	const stages: StagesConfig = {
		local,
		deployed,
		...(kept ? { protected: [kept] } : {}),
	};
	const problems = stageProblems(stages);
	if (problems.length) throw new InvalidStages(problems);
	return stages;
}

/** `--deploy` naming a target init has no scaffold for. */
export class UnknownDeployTarget extends Error {
	constructor(
		readonly target: string,
		readonly known: readonly string[],
	) {
		super(`Unknown deploy target "${target}". Use ${known.join(', ')}.`);
		this.name = 'UnknownDeployTarget';
	}
}

/** `--region` that is not shaped like one, e.g. `europe` for `eu-west-1`. */
export class NotAnAwsRegion extends Error {
	constructor(readonly region: string) {
		super(`"${region}" is not an AWS region. Use one like eu-west-1.`);
		this.name = 'NotAnAwsRegion';
	}
}
