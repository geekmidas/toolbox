import { apiTemplate } from './api.js';
import { minimalTemplate } from './minimal.js';
import { serverlessTemplate } from './serverless.js';
import { workerTemplate } from './worker.js';

/**
 * OpenAPI output path (fixed, not configurable)
 */
export const OPENAPI_OUTPUT_PATH = './.gkm/openapi.ts';

/**
 * Logger implementation type
 */
export type LoggerType = 'pino' | 'console';

/**
 * Routes structure pattern
 */
export type RoutesStructure =
	| 'centralized-endpoints'
	| 'centralized-routes'
	| 'domain-based';

/**
 * Package manager type
 */
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/**
 * Deploy target type
 */
export type DeployTarget = 'dokploy' | 'none';

/**
 * Services selection
 */
export interface ServicesSelection {
	db: boolean;
	cache: boolean;
	mail: boolean;
}

/**
 * Options collected from user prompts
 */
export interface TemplateOptions {
	name: string;
	template: TemplateName;
	telescope: boolean;
	database: boolean;
	studio: boolean;
	loggerType: LoggerType;
	routesStructure: RoutesStructure;
	monorepo: boolean;
	/** Path for the API app in monorepo (e.g., 'apps/api') */
	apiPath: string;
	/** Selected package manager */
	packageManager: PackageManager;
	/** Deploy target */
	deployTarget: DeployTarget;
	/** Services selection */
	services: ServicesSelection;
}

/**
 * A file to be generated
 */
export interface GeneratedFile {
	path: string;
	content: string;
}

/**
 * Template configuration
 */
export interface TemplateConfig {
	name: TemplateName;
	description: string;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	scripts: Record<string, string>;
	files: (options: TemplateOptions) => GeneratedFile[];
}

export type TemplateName =
	| 'minimal'
	| 'api'
	| 'serverless'
	| 'worker'
	| 'fullstack';

/**
 * All available templates
 */
export const templates: Record<
	Exclude<TemplateName, 'fullstack'>,
	TemplateConfig
> = {
	minimal: minimalTemplate,
	api: apiTemplate,
	serverless: serverlessTemplate,
	worker: workerTemplate,
};

/**
 * Template choices for prompts (Story 1.11 simplified to api + fullstack)
 */
export const templateChoices = [
	{
		title: 'API',
		value: 'api' as TemplateName,
		description: 'Single backend API with endpoints',
	},
	{
		title: 'Fullstack',
		value: 'fullstack' as TemplateName,
		description: 'Monorepo with API + Next.js + shared models',
	},
];

/**
 * All template choices (includes advanced options)
 */
export const allTemplateChoices = [
	{
		title: 'Minimal',
		value: 'minimal' as TemplateName,
		description: 'Basic health endpoint',
	},
	{
		title: 'API',
		value: 'api' as TemplateName,
		description: 'Full API with auth, database, services',
	},
	{
		title: 'Fullstack',
		value: 'fullstack' as TemplateName,
		description: 'Monorepo with API + Next.js + shared models',
	},
	{
		title: 'Serverless',
		value: 'serverless' as TemplateName,
		description: 'AWS Lambda handlers',
	},
	{
		title: 'Worker',
		value: 'worker' as TemplateName,
		description: 'Background job processing',
	},
];

/**
 * Logger type choices for prompts
 */
export const loggerTypeChoices = [
	{
		title: 'Pino',
		value: 'pino' as LoggerType,
		description: 'Fast JSON logger for production (recommended)',
	},
	{
		title: 'Console',
		value: 'console' as LoggerType,
		description: 'Simple console logger for development',
	},
];

/**
 * Routes structure choices for prompts
 */
export const routesStructureChoices = [
	{
		title: 'Centralized (endpoints)',
		value: 'centralized-endpoints' as RoutesStructure,
		description: 'src/endpoints/**/*.ts',
	},
	{
		title: 'Centralized (routes)',
		value: 'centralized-routes' as RoutesStructure,
		description: 'src/routes/**/*.ts',
	},
	{
		title: 'Domain-based',
		value: 'domain-based' as RoutesStructure,
		description: 'src/**/routes/*.ts (e.g., src/users/routes/list.ts)',
	},
];

/**
 * Package manager choices for prompts
 */
export const packageManagerChoices = [
	{
		title: 'pnpm',
		value: 'pnpm' as PackageManager,
		description: 'Fast, disk space efficient (recommended)',
	},
	{
		title: 'npm',
		value: 'npm' as PackageManager,
		description: 'Node.js default package manager',
	},
	{
		title: 'yarn',
		value: 'yarn' as PackageManager,
		description: 'Yarn package manager',
	},
	{
		title: 'bun',
		value: 'bun' as PackageManager,
		description: 'Fast JavaScript runtime and package manager',
	},
];

/**
 * Deploy target choices for prompts
 */
export const deployTargetChoices = [
	{
		title: 'Dokploy',
		value: 'dokploy' as DeployTarget,
		description: 'Deploy to Dokploy (Docker-based hosting)',
	},
	{
		title: 'Configure later',
		value: 'none' as DeployTarget,
		description: 'Skip deployment setup for now',
	},
];

/**
 * Services choices for multi-select prompt
 */
export const servicesChoices = [
	{
		title: 'PostgreSQL',
		value: 'db',
		description: 'PostgreSQL database',
	},
	{
		title: 'Redis',
		value: 'cache',
		description: 'Redis cache',
	},
	{
		title: 'Mailpit',
		value: 'mail',
		description: 'Email testing service (dev only)',
	},
];

/**
 * Get a template by name
 */
export function getTemplate(name: TemplateName): TemplateConfig | null {
	if (name === 'fullstack') {
		// Fullstack template is handled specially, uses api template as base
		return templates.api;
	}
	const template = templates[name];
	if (!template) {
		throw new Error(`Unknown template: ${name}`);
	}
	return template;
}

/**
 * Check if a template is the fullstack monorepo template
 */
export function isFullstackTemplate(name: TemplateName): boolean {
	return name === 'fullstack';
}
