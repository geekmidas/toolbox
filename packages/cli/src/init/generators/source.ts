import type {
  GeneratedFile,
  TemplateConfig,
  TemplateOptions,
} from '../templates/index.js';

/**
 * Generate source files from template
 */
export function generateSourceFiles(
  options: TemplateOptions,
  template: TemplateConfig,
): GeneratedFile[] {
  return template.files(options);
}
