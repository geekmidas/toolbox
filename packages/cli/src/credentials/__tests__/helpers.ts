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

export function createPackageJson(name: string, dir: string) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ name, version: '0.0.1' }, null, 2),
	);
}
