import { describe, expect, it } from 'vitest';
import { DEPENDENCY_VERSIONS } from '../dependencies';
import {
	generateMonorepoFiles,
	generateRootConstructs,
} from '../generators/monorepo';
import { generatePackageJson } from '../generators/package';
import { generateSourceFiles } from '../generators/source';
import {
	type GeneratedFile,
	getTemplate,
	type LoggerType,
	type TemplateName,
	type TemplateOptions,
} from '../templates/index';

const base: TemplateOptions = {
	name: 'beetlefit',
	template: 'api',
	telescope: true,
	studio: true,
	loggerType: 'pino',
	routesStructure: 'centralized-endpoints',
	monorepo: false,
	apiPath: '',
	packageManager: 'pnpm',
	deployTarget: 'none',
	stages: { local: 'dev', deployed: ['prod'], protected: ['prod'] },
	constructs: { database: true, cache: false, uploads: false, mail: false },
};

/** The package.json files and the source a scaffold of this shape writes. */
function scaffold(options: Partial<TemplateOptions>): GeneratedFile[] {
	const o = { ...base, ...options } as TemplateOptions;
	const template = getTemplate(o.template as TemplateName)!;
	return [
		...generatePackageJson(o, template),
		...generateSourceFiles(o, template),
		...generateMonorepoFiles(o, template),
		...(o.template === 'fullstack' ? generateRootConstructs(o) : []),
	];
}

/** Every dependency range in every package.json the scaffold writes. */
function dependencies(files: GeneratedFile[]): Record<string, string> {
	const all: Record<string, string> = {};
	for (const file of files.filter((f) => f.path.endsWith('package.json'))) {
		const pkg = JSON.parse(file.content);
		Object.assign(all, pkg.dependencies, pkg.devDependencies);
	}
	return all;
}

const SHAPES: [string, Partial<TemplateOptions>][] = [
	['api', { template: 'api' }],
	['minimal', { template: 'minimal' }],
	['serverless', { template: 'serverless' }],
	['worker', { template: 'worker' }],
	[
		'fullstack',
		{
			template: 'fullstack',
			monorepo: true,
			apiPath: 'apps/api',
			frontendFramework: 'nextjs',
		},
	],
];

describe('the logger a scaffold installs', () => {
	it.each(
		SHAPES,
	)('installs no pino for the console logger — %s', (_shape, shape) => {
		const files = scaffold({ ...shape, loggerType: 'console' as LoggerType });

		expect(dependencies(files)).not.toHaveProperty('pino');
		for (const file of files) {
			expect(file.content).not.toMatch(/['"](@geekmidas\/logger\/)?pino['"]/);
		}
		// And it imports the logger it chose.
		expect(
			files.some((f) => f.content.includes("'@geekmidas/logger/console'")),
		).toBe(true);
	});

	it.each(SHAPES)('installs pino for the pino logger — %s', (_shape, shape) => {
		const files = scaffold({ ...shape, loggerType: 'pino' as LoggerType });

		expect(dependencies(files).pino).toBe(DEPENDENCY_VERSIONS.pino);
		expect(
			files.some((f) => f.content.includes("'@geekmidas/logger/pino'")),
		).toBe(true);
	});
});
