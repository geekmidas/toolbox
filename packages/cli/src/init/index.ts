import prompts from 'prompts';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  detectPackageManager,
  validateProjectName,
  checkDirectoryExists,
  getInstallCommand,
  getRunCommand,
} from './utils.js';
import {
  getTemplate,
  templateChoices,
  routeStyleChoices,
  type TemplateName,
  type TemplateOptions,
  type RouteStyle,
} from './templates/index.js';
import { generatePackageJson } from './generators/package.js';
import { generateConfigFiles } from './generators/config.js';
import { generateEnvFiles } from './generators/env.js';
import { generateSourceFiles } from './generators/source.js';
import { generateDockerFiles } from './generators/docker.js';
import { generateMonorepoFiles } from './generators/monorepo.js';
import { generateModelsPackage } from './generators/models.js';

export interface InitOptions {
  template?: TemplateName;
  skipInstall?: boolean;
  yes?: boolean;
  monorepo?: boolean;
  apiPath?: string;
}

/**
 * Main init command - scaffolds a new project
 */
export async function initCommand(
  projectName?: string,
  options: InitOptions = {},
): Promise<void> {
  console.log('\n  Welcome to gkm!\n');

  const cwd = process.cwd();
  const pkgManager = detectPackageManager(cwd);

  // Handle Ctrl+C gracefully
  prompts.override({});
  const onCancel = () => {
    console.log('\n  Cancelled.\n');
    process.exit(0);
  };

  // Gather answers via prompts
  const answers = await prompts(
    [
      {
        type: projectName ? null : 'text',
        name: 'name',
        message: 'Project name:',
        initial: 'my-api',
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
        type: options.yes ? null : 'confirm',
        name: 'telescope',
        message: 'Include Telescope (debugging dashboard)?',
        initial: true,
      },
      {
        type: options.yes ? null : 'confirm',
        name: 'database',
        message: 'Include database support (Kysely)?',
        initial: true,
      },
      {
        type: options.yes ? null : 'select',
        name: 'routeStyle',
        message: 'Route organization:',
        choices: routeStyleChoices,
        initial: 0,
      },
      {
        type: options.yes || options.monorepo !== undefined ? null : 'confirm',
        name: 'monorepo',
        message: 'Setup as monorepo?',
        initial: false,
      },
      {
        type: (prev) =>
          (prev === true || options.monorepo) && !options.apiPath ? 'text' : null,
        name: 'apiPath',
        message: 'API app path:',
        initial: 'apps/api',
      },
    ],
    { onCancel },
  );

  // Build final options
  const name = projectName || answers.name;
  if (!name) {
    console.error('  Error: Project name is required\n');
    process.exit(1);
  }

  // Validate name if provided via argument
  if (projectName) {
    const nameValid = validateProjectName(projectName);
    if (nameValid !== true) {
      console.error(`  Error: ${nameValid}\n`);
      process.exit(1);
    }
    const dirValid = checkDirectoryExists(projectName, cwd);
    if (dirValid !== true) {
      console.error(`  Error: ${dirValid}\n`);
      process.exit(1);
    }
  }

  const monorepo = options.monorepo ?? (options.yes ? false : (answers.monorepo ?? false));
  const templateOptions: TemplateOptions = {
    name,
    template: options.template || answers.template || 'minimal',
    telescope: options.yes ? true : (answers.telescope ?? true),
    database: options.yes ? true : (answers.database ?? true),
    routeStyle: options.yes ? 'file-based' : (answers.routeStyle ?? 'file-based'),
    monorepo,
    apiPath: monorepo ? (options.apiPath ?? answers.apiPath ?? 'apps/api') : '',
  };

  const targetDir = join(cwd, name);
  const template = getTemplate(templateOptions.template);

  const isMonorepo = templateOptions.monorepo;
  const apiPath = templateOptions.apiPath;
  console.log(
    `\n  Creating ${name} with ${template.name} template${isMonorepo ? ' (monorepo)' : ''}...\n`,
  );

  // Create project directory
  await mkdir(targetDir, { recursive: true });

  // For monorepo, app files go in the specified apiPath (e.g., apps/api)
  const appDir = isMonorepo ? join(targetDir, apiPath) : targetDir;
  if (isMonorepo) {
    await mkdir(appDir, { recursive: true });
  }

  // Collect app files
  const appFiles = [
    ...generatePackageJson(templateOptions, template),
    ...generateConfigFiles(templateOptions, template),
    ...generateEnvFiles(templateOptions, template),
    ...generateSourceFiles(templateOptions, template),
    ...generateDockerFiles(templateOptions, template),
  ];

  // Collect root monorepo files (includes packages/models)
  const rootFiles = [
    ...generateMonorepoFiles(templateOptions, template),
    ...generateModelsPackage(templateOptions),
  ];

  // Write root files (for monorepo)
  for (const { path, content } of rootFiles) {
    const fullPath = join(targetDir, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
    console.log(`  ✓ ${path}`);
  }

  // Write app files
  for (const { path, content } of appFiles) {
    const fullPath = join(appDir, path);
    const displayPath = isMonorepo ? `${apiPath}/${path}` : path;
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
    console.log(`  ✓ ${displayPath}`);
  }

  // Install dependencies
  if (!options.skipInstall) {
    console.log(`\n  Installing dependencies with ${pkgManager}...\n`);
    try {
      execSync(getInstallCommand(pkgManager), {
        cwd: targetDir,
        stdio: 'inherit',
      });
    } catch {
      console.error('\n  Warning: Failed to install dependencies.');
      console.log(`  Run "${getInstallCommand(pkgManager)}" manually.\n`);
    }
  }

  // Print next steps
  const devCommand = getRunCommand(pkgManager, 'dev');
  console.log(`
  Done! Next steps:

    cd ${name}
    ${devCommand}

  Happy coding!
`);
}
