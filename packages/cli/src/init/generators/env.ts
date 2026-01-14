import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';

/**
 * Generate environment-related files (.gitignore only).
 * Note: .env files are no longer generated. Use `gkm secrets:init` to initialize
 * encrypted secrets stored in `.gkm/secrets/{stage}.json` with keys stored at
 * `~/.gkm/{project-name}/{stage}.key`.
 */
export function generateEnvFiles(
	options: TemplateOptions,
	_template: TemplateConfig,
): GeneratedFile[] {
	const files: GeneratedFile[] = [];

	// Only add .gitignore for non-monorepo (monorepo has it at root)
	if (!options.monorepo) {
		const gitignore = `# Dependencies
node_modules/

# Build output
dist/
.gkm/

# Environment (legacy - use gkm secrets instead)
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# Test coverage
coverage/

# TypeScript cache
*.tsbuildinfo
`;
		files.push({
			path: '.gitignore',
			content: gitignore,
		});
	}

	return files;
}
