import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import prompts from 'prompts';
import { createStageSecrets } from '../secrets/generator.js';
import { getKeyPath } from '../secrets/keystore.js';
import { writeStageSecrets } from '../secrets/storage.js';
import type { ComposeServiceName } from '../types.js';
import { generateAuthAppFiles } from './generators/auth.js';
import { generateConfigFiles } from './generators/config.js';
import { type DatabaseAppConfig, generateDockerFiles } from './generators/docker.js';
import { generateEnvFiles } from './generators/env.js';
import { generateModelsPackage } from './generators/models.js';
import { generateMonorepoFiles } from './generators/monorepo.js';
import { generatePackageJson } from './generators/package.js';
import { generateSourceFiles } from './generators/source.js';
import { generateWebAppFiles } from './generators/web.js';
import {
	type DeployTarget,
	deployTargetChoices,
	getTemplate,
	isFullstackTemplate,
	loggerTypeChoices,
	packageManagerChoices,
	type PackageManager,
	routesStructureChoices,
	type ServicesSelection,
	servicesChoices,
	type TemplateName,
	type TemplateOptions,
	templateChoices,
} from './templates/index.js';
import {
	checkDirectoryExists,
	detectPackageManager,
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
}

/**
 * Generate a secure random password for database users
 */
function generateDbPassword(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Generate database URL for an app
 * All apps connect to the same database, but use different users/schemas
 */
function generateDbUrl(appName: string, password: string, projectName: string, host = 'localhost', port = 5432): string {
	const userName = appName.replace(/-/g, '_');
	const dbName = `${projectName.replace(/-/g, '_')}_dev`;
	return `postgresql://${userName}:${password}@${host}:${port}/${dbName}`;
}

/**
 * Main init command - scaffolds a new project
 */
export async function initCommand(
	projectName?: string,
	options: InitOptions = {},
): Promise<void> {
	const cwd = process.cwd();
	const detectedPkgManager = detectPackageManager(cwd);

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
				name: 'services',
				message: 'Services (space to select, enter to confirm):',
				choices: servicesChoices.map((c) => ({ ...c, selected: true })),
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
				type: options.yes ? null : 'select',
				name: 'deployTarget',
				message: 'Deployment target:',
				choices: deployTargetChoices,
				initial: 0,
			},
			{
				type: options.yes ? null : 'confirm',
				name: 'telescope',
				message: 'Include Telescope (debugging dashboard)?',
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

	// Parse services selection
	const servicesArray: string[] = options.yes
		? ['db', 'cache', 'mail']
		: answers.services || [];
	const services: ServicesSelection = {
		db: servicesArray.includes('db'),
		cache: servicesArray.includes('cache'),
		mail: servicesArray.includes('mail'),
	};

	const pkgManager: PackageManager = options.pm
		? options.pm
		: options.yes
			? 'pnpm'
			: (answers.packageManager ?? detectedPkgManager);

	const deployTarget: DeployTarget = options.yes
		? 'dokploy'
		: (answers.deployTarget ?? 'dokploy');

	const database = services.db;
	const templateOptions: TemplateOptions = {
		name,
		template,
		telescope: options.yes ? true : (answers.telescope ?? true),
		database,
		studio: database,
		loggerType: options.yes ? 'pino' : (answers.loggerType ?? 'pino'),
		routesStructure: options.yes
			? 'centralized-endpoints'
			: (answers.routesStructure ?? 'centralized-endpoints'),
		monorepo,
		apiPath: monorepo ? (options.apiPath ?? 'apps/api') : '',
		packageManager: pkgManager,
		deployTarget,
		services,
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

	// Generate per-app database configs for fullstack template
	const dbApps: DatabaseAppConfig[] = [];
	if (isFullstack && services.db) {
		dbApps.push(
			{ name: 'api', password: generateDbPassword() },
			{ name: 'auth', password: generateDbPassword() },
		);
	}

	// Collect app files (backend/api)
	// Note: Docker files go to root for monorepo, so exclude them here
	const appFiles = baseTemplate
		? [
				...generatePackageJson(templateOptions, baseTemplate),
				...generateConfigFiles(templateOptions, baseTemplate),
				...generateEnvFiles(templateOptions, baseTemplate),
				...generateSourceFiles(templateOptions, baseTemplate),
				...(isMonorepo ? [] : generateDockerFiles(templateOptions, baseTemplate, dbApps)),
			]
		: [];

	// For monorepo, docker files go at root level
	const dockerFiles = isMonorepo && baseTemplate
		? generateDockerFiles(templateOptions, baseTemplate, dbApps)
		: [];

	// Collect root monorepo files (includes packages/models)
	const rootFiles = baseTemplate
		? [
				...generateMonorepoFiles(templateOptions, baseTemplate),
				...generateModelsPackage(templateOptions),
			]
		: [];

	// Collect web app files for fullstack template
	const webAppFiles = isFullstack ? generateWebAppFiles(templateOptions) : [];

	// Collect auth app files for fullstack template
	const authAppFiles = isFullstack ? generateAuthAppFiles(templateOptions) : [];

	// Write root files (for monorepo)
	for (const { path, content } of rootFiles) {
		const fullPath = join(targetDir, path);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content);
	}

	// Write docker files at root for monorepo
	for (const { path, content } of dockerFiles) {
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

	// Initialize encrypted secrets for development stage
	console.log('🔐 Initializing encrypted secrets...\n');
	const secretServices: ComposeServiceName[] = [];
	if (services.db) secretServices.push('postgres');
	if (services.cache) secretServices.push('redis');

	const devSecrets = createStageSecrets('development', secretServices);

	// Add common custom secrets
	devSecrets.custom = {
		NODE_ENV: 'development',
		PORT: '3000',
		LOG_LEVEL: 'debug',
		JWT_SECRET: `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	};

	await writeStageSecrets(devSecrets, targetDir);
	const keyPath = getKeyPath('development', name);
	console.log(`  Secrets: .gkm/secrets/development.json (encrypted)`);
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

		// Format generated files with biome
		try {
			execSync('npx @biomejs/biome format --write --unsafe .', {
				cwd: targetDir,
				stdio: 'inherit',
			});
		} catch {
			// Silently ignore format errors
		}
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

	if (options.services.db) {
		console.log(`  # Start PostgreSQL (if not running)`);
		console.log(`  docker compose up -d postgres`);
	}

	console.log(`  ${devCommand}`);
	console.log('');

	if (options.monorepo) {
		console.log('📁 Project structure:');
		console.log(`  ${projectName}/`);
		console.log(`  ├── apps/`);
		console.log(`  │   ├── api/          # Backend API`);
		if (isFullstackTemplate(options.template)) {
			console.log(`  │   └── web/          # Next.js frontend`);
		}
		console.log(`  ├── packages/`);
		console.log(`  │   └── models/       # Shared Zod schemas`);
		console.log(`  ├── .gkm/secrets/     # Encrypted secrets`);
		console.log(`  ├── gkm.config.ts     # Workspace config`);
		console.log(`  └── turbo.json        # Turbo config`);
		console.log('');
	}

	console.log('🔐 Secrets management:');
	console.log(`  gkm secrets:show --stage development  # View secrets`);
	console.log(`  gkm secrets:set KEY VALUE --stage development  # Add secret`);
	console.log(`  gkm secrets:init --stage production  # Create production secrets`);
	console.log('');

	if (options.deployTarget === 'dokploy') {
		console.log('🚀 Deployment:');
		console.log(`  ${getRunCommand(pkgManager, 'deploy')}`);
		console.log('');
	}

	console.log('📚 Documentation: https://docs.geekmidas.dev');
	console.log('');
}
