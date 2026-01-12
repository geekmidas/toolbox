#!/usr/bin/env -S npx tsx

import { Command } from 'commander';
import pkg from '../package.json';
import { loginCommand, logoutCommand, whoamiCommand } from './auth';
import { buildCommand } from './build/index';
import { type DeployProvider, deployCommand } from './deploy/index';
import { deployInitCommand, deployListCommand } from './deploy/init';
import { devCommand } from './dev/index';
import { type DockerOptions, dockerCommand } from './docker/index';
import { type InitOptions, initCommand } from './init/index';
import { openapiCommand } from './openapi';
import { generateReactQueryCommand } from './openapi-react-query';
import {
	secretsImportCommand,
	secretsInitCommand,
	secretsRotateCommand,
	secretsSetCommand,
	secretsShowCommand,
} from './secrets';
import type { ComposeServiceName, LegacyProvider, MainProvider } from './types';

const program = new Command();

program
	.name('gkm')
	.description('GeekMidas backend framework CLI')
	.version(pkg.version)
	.option('--cwd <path>', 'Change working directory');

program
	.command('init')
	.description('Scaffold a new project')
	.argument('[name]', 'Project name')
	.option(
		'--template <template>',
		'Project template (minimal, api, serverless, worker)',
	)
	.option('--skip-install', 'Skip dependency installation', false)
	.option('-y, --yes', 'Skip prompts, use defaults', false)
	.option('--monorepo', 'Setup as monorepo with packages/models', false)
	.option('--api-path <path>', 'API app path in monorepo (default: apps/api)')
	.action(async (name: string | undefined, options: InitOptions) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await initCommand(name, options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Command failed');
			process.exit(1);
		}
	});

program
	.command('build')
	.description('Build handlers from endpoints, functions, and crons')
	.option(
		'--provider <provider>',
		'Target provider for generated handlers (aws, server)',
	)
	.option(
		'--providers <providers>',
		'[DEPRECATED] Use --provider instead. Target providers for generated handlers (comma-separated)',
	)
	.option(
		'--enable-openapi',
		'Enable OpenAPI documentation generation for server builds',
	)
	.option('--production', 'Build for production (no dev tools, bundled output)')
	.option('--skip-bundle', 'Skip bundling step in production build')
	.option('--stage <stage>', 'Inject encrypted secrets for deployment stage')
	.action(
		async (options: {
			provider?: string;
			providers?: string;
			enableOpenapi?: boolean;
			production?: boolean;
			skipBundle?: boolean;
			stage?: string;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				// Handle new single provider option
				if (options.provider) {
					if (!['aws', 'server'].includes(options.provider)) {
						process.exit(1);
					}
					await buildCommand({
						provider: options.provider as MainProvider,
						enableOpenApi: options.enableOpenapi || false,
						production: options.production || false,
						skipBundle: options.skipBundle || false,
						stage: options.stage,
					});
				}
				// Handle legacy providers option
				else if (options.providers) {
					const providerList = [
						...new Set(options.providers.split(',').map((p) => p.trim())),
					] as LegacyProvider[];
					await buildCommand({
						providers: providerList,
						enableOpenApi: options.enableOpenapi || false,
						production: options.production || false,
						skipBundle: options.skipBundle || false,
						stage: options.stage,
					});
				}
				// Default to config-driven build
				else {
					await buildCommand({
						enableOpenApi: options.enableOpenapi || false,
						production: options.production || false,
						skipBundle: options.skipBundle || false,
						stage: options.stage,
					});
				}
			} catch (error) {
				console.error(error instanceof Error ? error.message : 'Command failed');
				process.exit(1);
			}
		},
	);

program
	.command('dev')
	.description('Start development server with automatic reload')
	.option('-p, --port <port>', 'Port to run the development server on')
	.option(
		'--enable-openapi',
		'Enable OpenAPI documentation for development server',
		true,
	)
	.action(async (options: { port?: string; enableOpenapi?: boolean }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}

			await devCommand({
				port: options.port ? Number.parseInt(options.port, 10) : 3000,
				portExplicit: !!options.port,
				enableOpenApi: options.enableOpenapi ?? true,
			});
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Command failed');
			process.exit(1);
		}
	});

program
	.command('cron')
	.description('Manage cron jobs')
	.action(() => {
		const globalOptions = program.opts();
		if (globalOptions.cwd) {
			process.chdir(globalOptions.cwd);
		}
		process.stdout.write('Cron management - coming soon\n');
	});

program
	.command('function')
	.description('Manage serverless functions')
	.action(() => {
		const globalOptions = program.opts();
		if (globalOptions.cwd) {
			process.chdir(globalOptions.cwd);
		}
		process.stdout.write('Serverless function management - coming soon\n');
	});

program
	.command('api')
	.description('Manage REST API endpoints')
	.action(() => {
		const globalOptions = program.opts();
		if (globalOptions.cwd) {
			process.chdir(globalOptions.cwd);
		}
		process.stdout.write('REST API management - coming soon\n');
	});

program
	.command('openapi')
	.description('Generate OpenAPI specification from endpoints')
	.action(async () => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await openapiCommand({});
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Command failed');
			process.exit(1);
		}
	});

program
	.command('generate:react-query')
	.description('Generate React Query hooks from OpenAPI specification')
	.option('--input <path>', 'Input OpenAPI spec file path', 'openapi.json')
	.option(
		'--output <path>',
		'Output file path for generated hooks',
		'src/api/hooks.ts',
	)
	.option('--name <name>', 'API name prefix for generated code', 'API')
	.action(
		async (options: { input?: string; output?: string; name?: string }) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}
				await generateReactQueryCommand(options);
			} catch (error) {
				console.error(error instanceof Error ? error.message : 'Command failed');
				process.exit(1);
			}
		},
	);

program
	.command('docker')
	.description('Generate Docker deployment files')
	.option('--build', 'Build Docker image after generating files')
	.option('--push', 'Push image to registry after building')
	.option('--tag <tag>', 'Image tag', 'latest')
	.option('--registry <registry>', 'Container registry URL')
	.option('--slim', 'Use slim Dockerfile (assumes pre-built bundle exists)')
	.option('--turbo', 'Use turbo prune for monorepo optimization')
	.option('--turbo-package <name>', 'Package name for turbo prune')
	.action(async (options: DockerOptions) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await dockerCommand(options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Command failed');
			process.exit(1);
		}
	});

program
	.command('prepack')
	.description('Generate Docker files for production deployment')
	.option('--build', 'Build Docker image after generating files')
	.option('--push', 'Push image to registry after building')
	.option('--tag <tag>', 'Image tag', 'latest')
	.option('--registry <registry>', 'Container registry URL')
	.option('--slim', 'Build locally first, then use slim Dockerfile')
	.option('--skip-bundle', 'Skip bundling step (only with --slim)')
	.option('--turbo', 'Use turbo prune for monorepo optimization')
	.option('--turbo-package <name>', 'Package name for turbo prune')
	.action(
		async (options: {
			build?: boolean;
			push?: boolean;
			tag?: string;
			registry?: string;
			slim?: boolean;
			skipBundle?: boolean;
			turbo?: boolean;
			turboPackage?: string;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				if (options.slim) {
					await buildCommand({
						provider: 'server',
						production: true,
						skipBundle: options.skipBundle,
					});
				}
				await dockerCommand({
					build: options.build,
					push: options.push,
					tag: options.tag,
					registry: options.registry,
					slim: options.slim,
					turbo: options.turbo,
					turboPackage: options.turboPackage,
				});
				if (options.slim) {
				} else {
				}

				if (options.build) {
					const tag = options.tag ?? 'latest';
					const registry = options.registry;
					const _imageRef = registry ? `${registry}/api:${tag}` : `api:${tag}`;
				}
			} catch (error) {
				console.error(error instanceof Error ? error.message : 'Command failed');
				process.exit(1);
			}
		},
	);

// Secrets management commands
program
	.command('secrets:init')
	.description('Initialize secrets for a deployment stage')
	.requiredOption('--stage <stage>', 'Stage name (e.g., production, staging)')
	.option('--force', 'Overwrite existing secrets')
	.action(async (options: { stage: string; force?: boolean }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await secretsInitCommand(options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Command failed');
			process.exit(1);
		}
	});

program
	.command('secrets:set')
	.description('Set a custom secret for a stage')
	.argument('<key>', 'Secret key (e.g., API_KEY)')
	.argument('[value]', 'Secret value (reads from stdin if omitted)')
	.requiredOption('--stage <stage>', 'Stage name')
	.action(
		async (
			key: string,
			value: string | undefined,
			options: { stage: string },
		) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}
				await secretsSetCommand(key, value, options);
			} catch (error) {
				console.error(error instanceof Error ? error.message : 'Command failed');
				process.exit(1);
			}
		},
	);

program
	.command('secrets:show')
	.description('Show secrets for a stage')
	.requiredOption('--stage <stage>', 'Stage name')
	.option('--reveal', 'Show actual secret values (not masked)')
	.action(async (options: { stage: string; reveal?: boolean }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await secretsShowCommand(options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Command failed');
			process.exit(1);
		}
	});

program
	.command('secrets:rotate')
	.description('Rotate service passwords')
	.requiredOption('--stage <stage>', 'Stage name')
	.option(
		'--service <service>',
		'Specific service to rotate (postgres, redis, rabbitmq)',
	)
	.action(async (options: { stage: string; service?: ComposeServiceName }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await secretsRotateCommand(options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Command failed');
			process.exit(1);
		}
	});

program
	.command('secrets:import')
	.description('Import secrets from a JSON file')
	.argument('<file>', 'JSON file path (e.g., secrets.json)')
	.requiredOption('--stage <stage>', 'Stage name')
	.option('--no-merge', 'Replace all custom secrets instead of merging')
	.action(async (file: string, options: { stage: string; merge?: boolean }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await secretsImportCommand(file, options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : 'Command failed');
			process.exit(1);
		}
	});

// Deploy command
program
	.command('deploy')
	.description('Deploy application to a provider')
	.requiredOption(
		'--provider <provider>',
		'Deploy provider (docker, dokploy, aws-lambda)',
	)
	.requiredOption(
		'--stage <stage>',
		'Deployment stage (e.g., production, staging)',
	)
	.option('--tag <tag>', 'Image tag (default: stage-timestamp)')
	.option('--skip-push', 'Skip pushing image to registry')
	.option('--skip-build', 'Skip build step (use existing build)')
	.action(
		async (options: {
			provider: string;
			stage: string;
			tag?: string;
			skipPush?: boolean;
			skipBuild?: boolean;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				const validProviders = ['docker', 'dokploy', 'aws-lambda'];
				if (!validProviders.includes(options.provider)) {
					console.error(
						`Invalid provider: ${options.provider}\n` +
							`Valid providers: ${validProviders.join(', ')}`,
					);
					process.exit(1);
				}

				await deployCommand({
					provider: options.provider as DeployProvider,
					stage: options.stage,
					tag: options.tag,
					skipPush: options.skipPush,
					skipBuild: options.skipBuild,
				});
			} catch (error) {
				console.error(
					error instanceof Error ? error.message : 'Deploy failed',
				);
				process.exit(1);
			}
		},
	);

// Deploy init command - Initialize Dokploy project and application
program
	.command('deploy:init')
	.description('Initialize Dokploy deployment (create project and application)')
	.option(
		'--endpoint <url>',
		'Dokploy server URL (uses stored credentials if logged in)',
	)
	.requiredOption('--project <name>', 'Project name (creates if not exists)')
	.requiredOption('--app <name>', 'Application name')
	.option('--project-id <id>', 'Use existing project ID instead of creating')
	.option('--registry-id <id>', 'Configure registry for the application')
	.action(
		async (options: {
			endpoint?: string;
			project: string;
			app: string;
			projectId?: string;
			registryId?: string;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				await deployInitCommand({
					endpoint: options.endpoint,
					projectName: options.project,
					appName: options.app,
					projectId: options.projectId,
					registryId: options.registryId,
				});
			} catch (error) {
				console.error(
					error instanceof Error
						? error.message
						: 'Failed to initialize deployment',
				);
				process.exit(1);
			}
		},
	);

// Deploy list command - List Dokploy resources
program
	.command('deploy:list')
	.description('List Dokploy resources (projects, registries)')
	.option(
		'--endpoint <url>',
		'Dokploy server URL (uses stored credentials if logged in)',
	)
	.option('--projects', 'List projects')
	.option('--registries', 'List registries')
	.action(
		async (options: {
			endpoint?: string;
			projects?: boolean;
			registries?: boolean;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				if (options.projects) {
					await deployListCommand({
						endpoint: options.endpoint,
						resource: 'projects',
					});
				}
				if (options.registries) {
					await deployListCommand({
						endpoint: options.endpoint,
						resource: 'registries',
					});
				}
				if (!options.projects && !options.registries) {
					// Default to listing both
					await deployListCommand({
						endpoint: options.endpoint,
						resource: 'projects',
					});
					await deployListCommand({
						endpoint: options.endpoint,
						resource: 'registries',
					});
				}
			} catch (error) {
				console.error(
					error instanceof Error ? error.message : 'Failed to list resources',
				);
				process.exit(1);
			}
		},
	);

// Login command
program
	.command('login')
	.description('Authenticate with a deployment service')
	.option('--service <service>', 'Service to login to (dokploy)', 'dokploy')
	.option('--token <token>', 'API token (will prompt if not provided)')
	.option('--endpoint <url>', 'Service endpoint URL')
	.action(
		async (options: { service: string; token?: string; endpoint?: string }) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				if (options.service !== 'dokploy') {
					console.error(
						`Unknown service: ${options.service}. Supported: dokploy`,
					);
					process.exit(1);
				}

				await loginCommand({
					service: options.service as 'dokploy',
					token: options.token,
					endpoint: options.endpoint,
				});
			} catch (error) {
				console.error(
					error instanceof Error ? error.message : 'Failed to login',
				);
				process.exit(1);
			}
		},
	);

// Logout command
program
	.command('logout')
	.description('Remove stored credentials')
	.option(
		'--service <service>',
		'Service to logout from (dokploy, all)',
		'dokploy',
	)
	.action(async (options: { service: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}

			await logoutCommand({
				service: options.service as 'dokploy' | 'all',
			});
		} catch (error) {
			console.error(
				error instanceof Error ? error.message : 'Failed to logout',
			);
			process.exit(1);
		}
	});

// Whoami command
program
	.command('whoami')
	.description('Show current authentication status')
	.action(async () => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}

			await whoamiCommand();
		} catch (error) {
			console.error(
				error instanceof Error ? error.message : 'Failed to get status',
			);
			process.exit(1);
		}
	});

program.parse();
