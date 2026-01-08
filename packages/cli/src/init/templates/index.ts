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

export type TemplateName = 'minimal' | 'api' | 'serverless' | 'worker';

/**
 * All available templates
 */
export const templates: Record<TemplateName, TemplateConfig> = {
	minimal: minimalTemplate,
	api: apiTemplate,
	serverless: serverlessTemplate,
	worker: workerTemplate,
};

/**
 * Template choices for prompts
 */
export const templateChoices = [
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
 * Get a template by name
 */
export function getTemplate(name: TemplateName): TemplateConfig {
	const template = templates[name];
	if (!template) {
		throw new Error(`Unknown template: ${name}`);
	}
	return template;
}
