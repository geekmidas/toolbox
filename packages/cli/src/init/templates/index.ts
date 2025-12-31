import { apiTemplate } from './api.js';
import { minimalTemplate } from './minimal.js';
import { serverlessTemplate } from './serverless.js';
import { workerTemplate } from './worker.js';

/**
 * Route organization style
 */
export type RouteStyle = 'file-based' | 'flat';

/**
 * Options collected from user prompts
 */
export interface TemplateOptions {
  name: string;
  template: TemplateName;
  telescope: boolean;
  database: boolean;
  routeStyle: RouteStyle;
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
 * Route style choices for prompts
 */
export const routeStyleChoices = [
  {
    title: 'File-based',
    value: 'file-based' as RouteStyle,
    description: 'Folder structure matches URL paths (users/list.ts → /users)',
  },
  {
    title: 'Flat',
    value: 'flat' as RouteStyle,
    description: 'All endpoints in one folder (users-list.ts → /users)',
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
