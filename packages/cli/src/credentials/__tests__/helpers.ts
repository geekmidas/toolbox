import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createSecretsFile(
	stage: string,
	secrets: Record<string, string>,
	root: string,
) {
	const secretsDir = join(root, '.gkm', 'secrets');
	mkdirSync(secretsDir, { recursive: true });
	const stageSecrets = {
		stage,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		services: {},
		urls: {},
		custom: secrets,
	};
	writeFileSync(
		join(secretsDir, `${stage}.json`),
		JSON.stringify(stageSecrets, null, 2),
	);
}

export function createDockerCompose(
	services: {
		name: string;
		envVar: string;
		defaultPort: number;
		containerPort: number;
	}[],
	root: string,
) {
	const svcEntries = services
		.map(
			(s) => `  ${s.name}:
    image: ${s.name}:latest
    ports:
      - '\${${s.envVar}:-${s.defaultPort}}:${s.containerPort}'`,
		)
		.join('\n');

	const content = `services:\n${svcEntries}\n`;
	writeFileSync(join(root, 'docker-compose.yml'), content);
}

export function createPortState(ports: Record<string, number>, root: string) {
	const dir = join(root, '.gkm');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'ports.json'), JSON.stringify(ports, null, 2));
}

export function createPackageJson(name: string, dir: string) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name, version: '0.0.1' }, null, 2),
	);
}

export function createWorkspaceConfig(
	apps: Record<
		string,
		{
			type: string;
			path: string;
			port: number;
			dependencies?: string[];
			framework?: string;
		}
	>,
	root: string,
) {
	const appEntries = Object.entries(apps)
		.map(([name, app]) => {
			const deps = app.dependencies
				? `dependencies: [${app.dependencies.map((d) => `'${d}'`).join(', ')}],`
				: '';
			if (app.type === 'frontend') {
				const framework = app.framework ?? 'nextjs';
				return `    ${name}: {
      type: '${app.type}',
      path: '${app.path}',
      port: ${app.port},
      framework: '${framework}',
      ${deps}
    },`;
			}
			return `    ${name}: {
      type: '${app.type}',
      path: '${app.path}',
      port: ${app.port},
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env#envParser',
      logger: './src/config/logger#logger',
      ${deps}
    },`;
		})
		.join('\n');

	const content = `import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'test-workspace',
  apps: {
${appEntries}
  },
  services: {},
});
`;
	writeFileSync(join(root, 'gkm.config.ts'), content);
}
