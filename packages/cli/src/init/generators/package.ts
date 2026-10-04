import { DEPENDENCY_VERSIONS, PNPM_VERSION } from '../dependencies.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * Generate package.json with dependencies based on template and options
 */
export function generatePackageJson(
	options: TemplateOptions,
	template: TemplateConfig,
): GeneratedFile[] {
	const { name, telescope, studio, monorepo } = options;
	const { database, cache, uploads, mail } = options.constructs;

	// Start with template dependencies
	const dependencies = { ...template.dependencies };
	const devDependencies = { ...template.devDependencies };
	const scripts = { ...template.scripts };

	// The logger the scaffold imports is `@geekmidas/logger/<loggerType>`, and
	// only the pino one needs pino installed beside it.
	if (options.loggerType === 'pino') {
		dependencies.pino = DEPENDENCY_VERSIONS.pino;
	}

	// Add optional dependencies based on user choices
	if (telescope) {
		dependencies['@geekmidas/telescope'] =
			GEEKMIDAS_VERSIONS['@geekmidas/telescope'];
	}

	if (studio) {
		dependencies['@geekmidas/studio'] = GEEKMIDAS_VERSIONS['@geekmidas/studio'];
	}

	// Only a project that declares constructs needs them. The workspace path
	// still reaches its infrastructure through hand-written services.
	const declares = !monorepo;

	// Every construct resolves its env key through the manifest, so declaring
	// one at all is what needs this — not any particular kind.
	if (declares && (database || uploads || cache || mail)) {
		dependencies['@geekmidas/manifest'] =
			GEEKMIDAS_VERSIONS['@geekmidas/manifest'];
	}

	// A construct hands back a client from the package that owns it, and each of
	// those is an optional peer — an app that declares no bucket resolves no S3
	// SDK. Installed here because the app declared one.
	if (declares && uploads) {
		dependencies['@geekmidas/storage'] =
			GEEKMIDAS_VERSIONS['@geekmidas/storage'];
	}

	if (declares && cache) {
		dependencies['@geekmidas/cache'] = GEEKMIDAS_VERSIONS['@geekmidas/cache'];
	}

	if (declares && mail) {
		dependencies['@geekmidas/emailkit'] =
			GEEKMIDAS_VERSIONS['@geekmidas/emailkit'];
	}

	if (database) {
		dependencies['@geekmidas/db'] = GEEKMIDAS_VERSIONS['@geekmidas/db'];
		dependencies.kysely = DEPENDENCY_VERSIONS.kysely;
		dependencies.pg = DEPENDENCY_VERSIONS.pg;
		devDependencies['@types/pg'] = DEPENDENCY_VERSIONS['@types/pg'];
		devDependencies['@geekmidas/testkit'] =
			GEEKMIDAS_VERSIONS['@geekmidas/testkit'];
		devDependencies['@faker-js/faker'] = DEPENDENCY_VERSIONS['@faker-js/faker'];
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
		// A workspace's root carries this; a standalone app is its own root.
		...(!monorepo && options.packageManager === 'pnpm'
			? { packageManager: PNPM_VERSION }
			: {}),
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
