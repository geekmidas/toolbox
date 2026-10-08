#!/usr/bin/env -S npx tsx

import { resolve } from 'node:path';
import { Command, Option } from 'commander';
import pkg from '../package.json';
import { loginCommand, logoutCommand, whoamiCommand } from './auth';
import {
	buildCommand,
	isMainProvider,
	UnknownBuildProvider,
	UnknownCacheBackend,
} from './build/index';
import { type ComposeOptions, composeCommand } from './compose/index';
import { enableDebug, formatError } from './debug';
import { deployInitCommand, deployListCommand } from './deploy/init';
import {
	stateDiffCommand,
	statePullCommand,
	statePushCommand,
	stateShowCommand,
	stateUnlockCommand,
} from './deploy/state-commands';
import { devCommand, execCommand } from './dev/index';
import { type DockerOptions, dockerCommand } from './docker/index';
import { type InitOptions, initCommand } from './init/index';
import { openapiCommand } from './openapi';
import {
	secretsImportCommand,
	secretsInitCommand,
	secretsRotateCommand,
	secretsSetCommand,
	secretsShowCommand,
	secretsUnsetCommand,
} from './secrets';
import type { SecretServiceName } from './secrets/types';
import { type SetupOptions, setupCommand } from './setup/index';
import { type TestOptions, testCommand } from './test/index';
import { trustCommand } from './trust/index';
import { isCacheBackend } from './types';
import { type UpgradeOptions, upgradeCommand } from './upgrade/index';

const program = new Command();

program
	.name('gkm')
	.description('GeekMidas backend framework CLI')
	.version(pkg.version)
	.option('--cwd <path>', 'Change working directory')
	.option('--debug', 'Enable debug mode (verbose errors with stack traces)')
	.hook('preAction', () => {
		const opts = program.opts();
		if (opts.debug) enableDebug();
	});

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
	.option('--pm <manager>', 'Package manager (pnpm, npm, yarn, bun)')
	.option('--deploy <target>', 'Where it deploys (dokploy, compose, sst, none)')
	.option('--region <region>', 'AWS region for an SST deploy (e.g. eu-west-1)')
	.option(
		'--registry <registry>',
		'Container registry for a compose deploy (e.g. ghcr.io/acme)',
	)
	.option(
		'--stages <names>',
		'Deployed stages, comma-separated (e.g. staging,prod)',
	)
	.option('--protected-stage <name>', 'Which deployed stage is production')
	.option('--local-stage <name>', 'What gkm dev runs as (e.g. dev)')
	.action(async (name: string | undefined, options: InitOptions) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await initCommand(name, options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('trust')
	.description(
		"Trust the local edge's certificate authority, so a browser accepts https",
	)
	.option('--dry-run', 'Print the commands instead of running them')
	.action(async (options: { dryRun?: boolean }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await trustCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('setup')
	.description(
		'Reconcile declared constructs — containers, databases, buckets, secrets',
	)
	.option('--stage <stage>', 'Stage name (default: stages.local)')
	.option('--force', 'Regenerate secrets even if they exist')
	.option('--skip-docker', 'Skip starting Docker services')
	.option('-y, --yes', 'Skip prompts')
	.action(async (options: SetupOptions) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await setupCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('build')
	.description('Build handlers and the manifest from declared constructs')
	.option(
		'--provider <provider>',
		'Build for aws or server (default: where gkm.config.ts deploys)',
	)
	.option(
		'--enable-openapi',
		'Enable OpenAPI documentation generation for server builds',
	)
	.option('--production', 'Build for production (no dev tools, bundled output)')
	.option('--skip-bundle', 'Skip bundling step in production build')
	.option('--stage <stage>', 'Inject encrypted secrets for deployment stage')
	.option(
		'--mark-optional',
		'Suffix optional env vars with ? in manifest envVars field (e.g. PORT?)',
	)
	// Written by the Dockerfiles `gkm compose` generates, whose stack runs its
	// own Redis: not a choice a project makes, so not in the help.
	.addOption(
		new Option(
			'--cache <backend>',
			'Register the drivers for this cache backend rather than the target default',
		).hideHelp(),
	)
	.action(
		async (options: {
			provider?: string;
			cache?: string;
			enableOpenapi?: boolean;
			production?: boolean;
			skipBundle?: boolean;
			stage?: string;
			markOptional?: boolean;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				if (
					options.provider !== undefined &&
					!isMainProvider(options.provider)
				) {
					throw new UnknownBuildProvider(options.provider);
				}
				if (options.cache !== undefined && !isCacheBackend(options.cache)) {
					throw new UnknownCacheBackend(options.cache);
				}

				await buildCommand({
					...(options.provider ? { provider: options.provider } : {}),
					...(options.cache ? { cache: options.cache } : {}),
					enableOpenApi: options.enableOpenapi || false,
					production: options.production || false,
					skipBundle: options.skipBundle || false,
					stage: options.stage,
					markOptional: options.markOptional || false,
				});
			} catch (error) {
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

program
	.command('dev')
	.description(
		'Reconcile constructs and start the dev server with automatic reload',
	)
	.option('-p, --port <port>', 'Port to run the development server on')
	.option('--entry <file>', 'Entry file to run (bypasses gkm config)')
	.option('--watch', 'Watch for file changes (default: true with --entry)')
	.option('--no-watch', 'Disable file watching')
	.option(
		'--enable-openapi',
		'Enable OpenAPI documentation for development server',
		true,
	)
	.option('--migrate', 'Apply pending migrations before the apps start')
	.option('--seed', 'Migrate, then run the seeds, before the apps start')
	.option(
		'--fake',
		'Call each external API’s fake (test/fakes/<id>.ts) instead of the provider',
	)
	.option(
		'--no-subscribers',
		'Run no topic subscribers: nothing is subscribed, polled or pushed to',
	)
	.action(
		async (options: {
			port?: string;
			entry?: string;
			watch?: boolean;
			enableOpenapi?: boolean;
			migrate?: boolean;
			seed?: boolean;
			fake?: boolean;
			subscribers?: boolean;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				await devCommand({
					// Unset without `--port`, so an app in a workspace gets the port the
					// workspace gave it. Defaulting to 3000 here meant every app asked
					// for 3000, and the first to start took it from the others.
					port: options.port ? Number.parseInt(options.port, 10) : undefined,
					portExplicit: !!options.port,
					enableOpenApi: options.enableOpenapi ?? true,
					entry: options.entry,
					watch: options.watch,
					migrate: options.migrate,
					seed: options.seed,
					fake: options.fake,
					subscribers: options.subscribers,
				});
			} catch (error) {
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

program
	.command('exec')
	.description('Run a command with secrets injected into Credentials')
	.argument('<command...>', 'Command to run (use -- before command)')
	.action(async (commandArgs: string[]) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await execCommand(commandArgs);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('test')
	.description('Run tests with secrets loaded from environment')
	.option(
		'--stage <stage>',
		'Stage to load secrets from (default: stages.local)',
	)
	.option('--run', 'Run tests once without watch mode')
	.option('--watch', 'Enable watch mode')
	.option('--coverage', 'Generate coverage report')
	.option('--ui', 'Open Vitest UI')
	.option(
		'--auto-setup',
		'Generate a fresh stage (secrets + key) from the workspace config when none exists (for CI; also via GKM_AUTO_SETUP)',
	)
	.option(
		'--prepare',
		'Write the test manifest and #test harness, then stop — for a typecheck that runs before the suite',
	)
	.option(
		'--setup',
		'Reconcile, migrate and seed the test stage and write the harness, then stop — what @geekmidas/cli/vitest runs',
	)
	.option(
		'--teardown',
		"Drop the test stage's databases the last setup created, then stop — what @geekmidas/cli/vitest runs when the suite ends",
	)
	.argument('[pattern]', 'Pattern to filter tests')
	.action(async (pattern: string | undefined, options: TestOptions) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await testCommand({ ...options, pattern });
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('migrate')
	.description(
		"Apply each database construct's migrations from db/<construct>/migrations/, as its owner",
	)
	.argument('[construct]', 'Only this construct, by name')
	.option(
		'--stage <stage>',
		'The local stage (default) or test — a deploy migrates its own stage',
	)
	.action(
		async (construct: string | undefined, options: { stage?: string }) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}
				const { migrateCommand } = await import('./migrate/index.js');
				await migrateCommand({
					...options,
					...(construct ? { construct } : {}),
				});
			} catch (error) {
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

program
	.command('seed')
	.description(
		"Migrate, then run each database construct's seeds from db/<construct>/seeds/, as its owner",
	)
	.argument('[construct]', 'Only this construct, by name')
	.option(
		'--stage <stage>',
		'The local stage (default) or test — a deploy seeds its own stage',
	)
	.action(
		async (construct: string | undefined, options: { stage?: string }) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}
				const { seedCommand } = await import('./migrate/index.js');
				await seedCommand({
					...options,
					...(construct ? { construct } : {}),
				});
			} catch (error) {
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

program
	.command('migration')
	.description(
		"Write a construct's next migration: an empty one for a database, the schema change for an auth server",
	)
	.argument('<construct>', 'The construct, by name')
	.argument('[name]', 'What the migration is called')
	.action(async (construct: string, name: string | undefined) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			const { migrationCommand } = await import('./migrate/index.js');
			await migrationCommand({ construct, ...(name ? { name } : {}) });
		} catch (error) {
			console.error(formatError(error));
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
	.option(
		'--app <name>',
		'Workspace mode: generate for a single named backend app',
	)
	.action(async (options: { app?: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await openapiCommand({ app: options.app });
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('docker')
	.description('Generate Docker deployment files')
	.option('--build', 'Build Docker image after generating files')
	.option('--push', 'Push image to registry after building')
	.option('--tag <tag>', 'Image tag', 'latest')
	.option('--registry <registry>', 'Container registry URL')
	.action(async (options: DockerOptions) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await dockerCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('compose')
	.description(
		"Run the workspace's APIs and sites for a stage as one Docker Compose stack behind Caddy",
	)
	.requiredOption(
		'--stage <stage>',
		'Stage to run — always named, so a stack is never a deployed stage by accident',
	)
	.option(
		'--tag <tag>',
		'Run the images CI pushed at this tag (sites: <tag>-<stage>); nothing is built',
	)
	.option('--build', 'Build images from this checkout, tagged with the commit')
	.option('--pull', 'Pull images (at --tag, or latest) rather than build them')
	.option(
		'--push',
		'With --build: push every image to deploy.registry and start nothing (for CI)',
	)
	.option(
		'--digests-file <path>',
		'With --push: write each image as <ref>@sha256:… (JSON). With --tag: run the images at those digests',
	)
	.option('--dry-run', 'Write the files and print the plan; start nothing')
	.option('--down', "Stop the stage's stack (its volumes are kept)")
	.option(
		'--allow-dev-services <list>',
		"Deployed stage: run MinIO and/or Mailpit (minio,mailpit) for mail and buckets the stage's secrets don't configure. Not production-grade",
	)
	.action(async (options: ComposeOptions) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await composeCommand(options);
		} catch (error) {
			console.error(formatError(error));
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
	.action(
		async (options: {
			build?: boolean;
			push?: boolean;
			tag?: string;
			registry?: string;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				await dockerCommand({
					build: options.build,
					push: options.push,
					tag: options.tag,
					registry: options.registry,
				});
			} catch (error) {
				console.error(formatError(error));
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
			console.error(formatError(error));
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
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

program
	.command('secrets:unset')
	.description('Remove a custom secret from a stage')
	.argument('<key>', 'Secret key (e.g., API_KEY)')
	.requiredOption('--stage <stage>', 'Stage name')
	.action(async (key: string, options: { stage: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await secretsUnsetCommand(key, options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('secrets:add')
	.description(
		"Build the keys a stage must be given — buckets, mail, file servers, third parties' credentials — across every app",
	)
	.requiredOption('--stage <stage>', 'Stage name')
	.option('--missing', 'Only the keys the stage has not set')
	.option('--json', 'Print the keys as JSON and ask nothing')
	.action(
		async (options: { stage: string; missing?: boolean; json?: boolean }) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}
				const { secretsAddCommand } = await import('./secrets/add');
				await secretsAddCommand(options);
			} catch (error) {
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

program
	.command('encryption:rotate')
	.description(
		"Add a new current key to an Encryption construct's keyring on a server stage",
	)
	.argument('<construct>', 'The Encryption construct (e.g. Pii)')
	.requiredOption('--stage <stage>', 'A deployed stage')
	.action(async (construct: string, options: { stage: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			const { encryptionRotateCommand } = await import('./encryption/index.js');
			await encryptionRotateCommand(construct, options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('encryption:retire')
	.description(
		"Remove an old key from an Encryption construct's keyring, once nothing is under it",
	)
	.argument('<construct>', 'The Encryption construct (e.g. Pii)')
	.argument('<key>', 'The key to retire (e.g. k1)')
	.requiredOption('--stage <stage>', 'A deployed stage')
	.action(
		async (construct: string, key: string, options: { stage: string }) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}
				const { encryptionRetireCommand } = await import(
					'./encryption/index.js'
				);
				await encryptionRetireCommand(construct, key, options);
			} catch (error) {
				console.error(formatError(error));
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
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('secrets:rotate')
	.description('Rotate service passwords')
	.requiredOption('--stage <stage>', 'Stage name')
	.option(
		'--service <service>',
		'Specific service to rotate (postgres, redis, minio, …)',
	)
	.action(async (options: { stage: string; service?: SecretServiceName }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await secretsRotateCommand(options);
		} catch (error) {
			console.error(formatError(error));
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
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('secrets:reconcile')
	.description('Backfill missing custom secrets from workspace config')
	.option('--stage <stage>', 'Stage name (default: stages.local)')
	.action(async (options: { stage?: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}

			const { loadWorkspaceConfig } = await import('./config');
			const { reconcileMissingSecrets } = await import('./secrets/reconcile');
			const { secretsStoreFor } = await import('./secrets/store');

			const { workspace } = await loadWorkspaceConfig();
			const stage = options.stage ?? workspace.stages.local;
			const store = await secretsStoreFor(workspace, stage);
			const secrets = await store.read(stage);

			if (!secrets) {
				console.error(
					`No secrets found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
				);
				process.exit(1);
			}

			const { derivedContainers } = await import('./reconcile/workspace');
			const result = reconcileMissingSecrets(
				secrets,
				workspace,
				await derivedContainers(workspace, stage),
			);

			if (!result) {
				console.log(`\n✓ Secrets for stage "${stage}" are up-to-date`);
				return;
			}

			await store.write(stage, result.secrets);
			console.log(
				`\n✓ Reconciled ${result.addedKeys.length} missing secret(s) for stage "${stage}":`,
			);
			for (const key of result.addedKeys) {
				console.log(`    + ${key}`);
			}
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('secrets:migrate')
	.description(
		"Copy a deployed stage's secrets from the configured store to another (file, ssm, secrets-manager)",
	)
	.requiredOption('--stage <stage>', 'A deployed stage')
	.requiredOption('--to <provider>', 'file, ssm or secrets-manager')
	.option(
		'--region <region>',
		"The target's AWS region (default: the configured store's)",
	)
	.option('--profile <profile>', "AWS profile for the stage's account")
	.option('--force', 'Replace a stage the target already holds')
	.action(
		async (options: {
			stage: string;
			to: string;
			region?: string;
			profile?: string;
			force?: boolean;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}
				const { secretsMigrateCommand } = await import('./secrets/migrate');
				await secretsMigrateCommand(options);
			} catch (error) {
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

// Deploy command — the terminal around `deploy()`: it prompts, prints and
// sets the exit code; the deploy itself does none of the three.
program
	.command('deploy')
	.description('Deploy a stage through its target')
	.option(
		'--target <name>',
		'Deploy target: dokploy, compose, sst, or one named in deploy.targets (default: deploy.default)',
	)
	.option('--provider <provider>', '[DEPRECATED] Use --target instead')
	.requiredOption(
		'--stage <stage>',
		'Deployment stage (e.g., production, staging)',
	)
	.option(
		'--tag <tag>',
		'Image tag (default: stage-timestamp; compose: the commit). Compose pulls a given tag',
	)
	.option('--skip-push', 'Skip pushing image to registry')
	.option('--skip-build', 'Skip build step (use existing build)')
	.option(
		'--json',
		'Write events as JSON lines instead of progress; never prompts',
	)
	.option(
		'--dry-run',
		'Show what would be created or reused; change, build and push nothing',
	)
	.option(
		'--atomic',
		'If the release fails, roll back every app it released, not only the failed ones',
	)
	.option(
		'--allow-dev-services <list>',
		"Server targets: run MinIO and/or Mailpit (minio,mailpit) for mail and buckets the stage's secrets don't configure. Not production-grade",
	)
	.action(
		async (options: {
			target?: string;
			provider?: string;
			stage: string;
			tag?: string;
			json?: boolean;
			dryRun?: boolean;
			atomic?: boolean;
			allowDevServices?: string;
		}) => {
			const { deployCli } = await import('./deploy/cli');
			const globalOptions = program.opts();
			// Passed down, not `process.chdir`ed into: the deploy is told which
			// project it is deploying.
			const code = await deployCli({
				cwd: resolve(globalOptions.cwd ?? process.cwd()),
				...(options.target ? { target: options.target } : {}),
				...(options.provider ? { provider: options.provider } : {}),
				stage: options.stage,
				...(options.tag ? { tag: options.tag } : {}),
				...(options.json ? { json: true } : {}),
				...(options.dryRun ? { dryRun: true } : {}),
				...(options.atomic ? { atomic: true } : {}),
				...(options.allowDevServices
					? { allowDevServices: options.allowDevServices }
					: {}),
			});
			if (code !== 0) process.exit(code);
		},
	);

// Rollback — a stage's apps back on the release before the one they run.
program
	.command('deploy:rollback')
	.description(
		"Put a stage's app back on its previous release (Dokploy): one app with --app, every app with --atomic",
	)
	.requiredOption('--stage <stage>', 'A deployed stage')
	.option('--app <app>', 'The app to roll back')
	.option('--atomic', 'Roll back every app that has an earlier release')
	.action(
		async (options: { stage: string; app?: string; atomic?: boolean }) => {
			try {
				const { rollbackStage } = await import('./target/dokploy/rollback');
				const { terminalCredentials } = await import('./deploy/terminal');
				const globalOptions = program.opts();
				await rollbackStage({
					cwd: resolve(globalOptions.cwd ?? process.cwd()),
					stage: options.stage,
					...(options.app ? { app: options.app } : {}),
					...(options.atomic ? { atomic: true } : {}),
					credentials: terminalCredentials(),
					log: (line) => console.log(line),
				});
			} catch (error) {
				console.error(formatError(error));
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
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

// Deploy list command - List Dokploy resources
program
	.command('deploy:github')
	.description(
		"Let GitHub Actions deploy a stage: OIDC role in the stage's AWS account, and the GitHub environment the deploy workflow uses",
	)
	.requiredOption('--stage <stage>', 'A deployed stage from gkm.config.ts')
	.option('--profile <profile>', "AWS profile for the stage's account")
	.option('--repo <owner/name>', 'GitHub repository (default: this one)')
	.option(
		'--policy-arn <arn>',
		'Policy for the deploy role (default: AdministratorAccess)',
	)
	.option('--dry-run', 'Show the plan without changing AWS or GitHub')
	.action(async (options) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			const { deployGithubCommand } = await import('./deploy/github.js');
			await deployGithubCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('stages')
	.description(
		"The workspace's stages from gkm.config.ts: local, deployed and protected",
	)
	.option('--json', 'Print them as JSON')
	.option(
		'--github-output',
		'Write the stages, and which this workflow run builds and deploys, to $GITHUB_OUTPUT',
	)
	.option(
		'--event <name>',
		'The event to plan for (default: $GITHUB_EVENT_NAME)',
	)
	.option('--stage <stage>', 'The stage a workflow_dispatch deploys')
	.action(async (options) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			const { stagesCommand } = await import('./stages/index.js');
			await stagesCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

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
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

// Login command
program
	.command('login')
	.description('Authenticate with a deployment or DNS provider')
	// `--provider`, the same word `gkm deploy` and the DNS config already use for
	// these same names. It was `--service`, which made `dokploy` a provider in
	// one command and a service in the next — and `service` is the most
	// overloaded word in this codebase already: the DI interface, the
	// `services:` backend block, and a Dokploy resource name.
	.option(
		'--provider <provider>',
		'Provider to log in to (dokploy, hostinger)',
		'dokploy',
	)
	// Kept working rather than removed: it is what shipped, and a flag rename is
	// not worth breaking somebody's CI over.
	.option('--service <provider>', '[DEPRECATED] Use --provider instead')
	.option('--token <token>', 'API token (will prompt if not provided)')
	.option('--endpoint <url>', 'Service endpoint URL')
	.action(
		async (options: {
			provider: string;
			service?: string;
			token?: string;
			endpoint?: string;
		}) => {
			try {
				const globalOptions = program.opts();
				if (globalOptions.cwd) {
					process.chdir(globalOptions.cwd);
				}

				// The alias wins when given, because a default is not a choice.
				const provider = options.service ?? options.provider;

				if (!['dokploy', 'hostinger'].includes(provider)) {
					console.error(
						`Unknown provider: ${provider}. Supported: dokploy, hostinger`,
					);
					process.exit(1);
				}

				await loginCommand({
					provider: provider as 'dokploy' | 'hostinger',
					token: options.token,
					endpoint: options.endpoint,
				});
			} catch (error) {
				console.error(formatError(error));
				process.exit(1);
			}
		},
	);

// Logout command
program
	.command('logout')
	.description('Remove stored credentials')
	.option(
		'--provider <provider>',
		'Whose credentials to remove (dokploy, all)',
		'dokploy',
	)
	.option('--service <provider>', '[DEPRECATED] Use --provider instead')
	.action(async (options: { provider: string; service?: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}

			await logoutCommand({
				provider: (options.service ?? options.provider) as 'dokploy' | 'all',
			});
		} catch (error) {
			console.error(formatError(error));
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
			console.error(formatError(error));
			process.exit(1);
		}
	});

// State management commands
program
	.command('state:pull')
	.description('Pull deployment state from remote to local')
	.requiredOption(
		'--stage <stage>',
		'Deployment stage (e.g., production, staging)',
	)
	.action(async (options: { stage: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await statePullCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('state:push')
	.description('Push deployment state from local to remote')
	.requiredOption(
		'--stage <stage>',
		'Deployment stage (e.g., production, staging)',
	)
	.action(async (options: { stage: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await statePushCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('state:show')
	.description('Show deployment state for a stage')
	.requiredOption(
		'--stage <stage>',
		'Deployment stage (e.g., production, staging)',
	)
	.option('--json', 'Output as JSON')
	.action(async (options: { stage: string; json?: boolean }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await stateShowCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('state:unlock')
	.description('Release a stage deploy lock left behind by a run that crashed')
	.requiredOption(
		'--stage <stage>',
		'Deployment stage (e.g., production, staging)',
	)
	.action(async (options: { stage: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await stateUnlockCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('state:diff')
	.description('Compare local and remote deployment state')
	.requiredOption(
		'--stage <stage>',
		'Deployment stage (e.g., production, staging)',
	)
	.action(async (options: { stage: string }) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await stateDiffCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program
	.command('upgrade')
	.description(
		'Upgrade @geekmidas/cli (with --all, every @geekmidas package) along the release line the project is on',
	)
	.option('--dry-run', 'Show what would be upgraded without making changes')
	.option(
		'--all',
		'Every @geekmidas package, and the third-party packages their peers require',
	)
	.option(
		'--tag <tag>',
		'npm dist-tag to follow (default: the line you are on)',
	)
	.action(async (options: UpgradeOptions) => {
		try {
			const globalOptions = program.opts();
			if (globalOptions.cwd) {
				process.chdir(globalOptions.cwd);
			}
			await upgradeCommand(options);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

program.parse();
