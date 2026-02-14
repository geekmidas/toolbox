import {
	type GeneratedFile,
	OPENAPI_OUTPUT_PATH,
	type TemplateConfig,
	type TemplateOptions,
} from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * Generate package.json with dependencies based on template and options
 */
export function generatePackageJson(
	options: TemplateOptions,
	template: TemplateConfig,
): GeneratedFile[] {
	const { name, telescope, database, studio, monorepo } = options;

	// Start with template dependencies
	const dependencies = { ...template.dependencies };
	const devDependencies = { ...template.devDependencies };
	const scripts = { ...template.scripts };

	// Add optional dependencies based on user choices
	if (telescope) {
		dependencies['@geekmidas/telescope'] =
			GEEKMIDAS_VERSIONS['@geekmidas/telescope'];
	}

	if (studio) {
		dependencies['@geekmidas/studio'] = GEEKMIDAS_VERSIONS['@geekmidas/studio'];
	}

	if (database) {
		dependencies['@geekmidas/db'] = GEEKMIDAS_VERSIONS['@geekmidas/db'];
		dependencies.kysely = '~0.28.2';
		dependencies.pg = '~8.16.0';
		devDependencies['@types/pg'] = '~8.15.0';
		devDependencies['@geekmidas/testkit'] =
			GEEKMIDAS_VERSIONS['@geekmidas/testkit'];
		devDependencies['@faker-js/faker'] = '~9.8.0';
		devDependencies['vite-tsconfig-paths'] = '~5.1.0';
	}

	// For monorepo apps, remove biome/turbo/esbuild (they're at root) and lint/fmt scripts
	// zod is at root level for monorepos
	if (monorepo) {
		delete devDependencies['@biomejs/biome'];
		delete devDependencies.turbo;
		delete devDependencies.esbuild;
		delete dependencies.zod;
		delete scripts.lint;
		delete scripts.fmt;
		delete scripts['fmt:check'];

		// Add models package as dependency
		dependencies[`@${name}/models`] = 'workspace:*';
	}

	// Sort dependencies alphabetically
	const sortObject = (obj: Record<string, string>) =>
		Object.fromEntries(
			Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
		);

	// For monorepo, derive package name from apiPath (e.g., apps/api -> @name/api)
	let packageName = name;
	if (monorepo && options.apiPath) {
		const pathParts = options.apiPath.split('/');
		const appName = pathParts[pathParts.length - 1] || 'api';
		packageName = `@${name}/${appName}`;
	}

	const packageJson = {
		name: packageName,
		version: '0.0.1',
		private: true,
		type: 'module',
		exports: {
			'./client': {
				types: OPENAPI_OUTPUT_PATH,
				import: OPENAPI_OUTPUT_PATH,
			},
		},
		scripts,
		dependencies: sortObject(dependencies),
		devDependencies: sortObject(devDependencies),
	};

	return [
		{
			path: 'package.json',
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
	];
}
