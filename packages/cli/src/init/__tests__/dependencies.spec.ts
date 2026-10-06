import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DEPENDENCY_VERSIONS,
	EXPO_VERSIONS,
	TOOLCHAIN_VERSIONS,
} from '../dependencies';
import { generateAuthAppFiles } from '../generators/auth';
import { generateExpoAppFiles } from '../generators/mobile-expo';
import { generateModelsPackage } from '../generators/models';
import { generateMonorepoFiles } from '../generators/monorepo';
import { generatePackageJson } from '../generators/package';
import { generateWebAppFiles } from '../generators/web';
import { generateTanStackWebFiles } from '../generators/web-tanstack';
import {
	type GeneratedFile,
	getTemplate,
	type TemplateName,
	type TemplateOptions,
} from '../templates/index';

const base: TemplateOptions = {
	name: 'shop',
	template: 'api',
	telescope: true,
	loggerType: 'pino',
	routesStructure: 'centralized-endpoints',
	monorepo: false,
	apiPath: '',
	packageManager: 'pnpm',
	deployTarget: 'sst',
	region: 'eu-west-1',
	stages: { local: 'dev', deployed: ['prod'], protected: ['prod'] },
	constructs: { database: true, cache: true, uploads: true, mail: true },
};

/** Every file a scaffold of this shape writes that pins anything. */
function scaffold(options: Partial<TemplateOptions>): GeneratedFile[] {
	const o = { ...base, ...options } as TemplateOptions;
	const template = getTemplate(o.template as TemplateName)!;
	return [
		...generatePackageJson(o, template),
		...generateMonorepoFiles(o, template),
		...generateModelsPackage(o),
		...generateAuthAppFiles(o),
		...generateWebAppFiles(o),
		...generateTanStackWebFiles(o),
		...generateExpoAppFiles(o),
	];
}

const SHAPES: [string, Partial<TemplateOptions>][] = [
	['api', { template: 'api' }],
	['minimal', { template: 'minimal' }],
	['serverless', { template: 'serverless' }],
	['worker', { template: 'worker' }],
	[
		'fullstack + Next.js',
		{
			template: 'fullstack',
			monorepo: true,
			apiPath: 'apps/api',
			frontendFramework: 'nextjs',
		},
	],
	[
		'fullstack + TanStack Start',
		{
			template: 'fullstack',
			monorepo: true,
			apiPath: 'apps/api',
			frontendFramework: 'tanstack-start',
		},
	],
	[
		'fullstack + Expo',
		{
			template: 'fullstack',
			monorepo: true,
			apiPath: 'apps/api',
			frontendFramework: 'expo',
		},
	],
];

/** Packages released in lockstep with another, and pinned to its version. */
const SAME_VERSION_AS: Record<string, string> = {
	'@better-auth/expo': 'better-auth',
};

// What gets installed. A peer range (the UI package's `react >=18`) states
// compatibility and installs nothing, so it is not a pin.
const FIELDS = ['dependencies', 'devDependencies'];

describe('the versions a scaffold installs', () => {
	it.each(SHAPES)('come from dependencies.ts — %s', (_, options) => {
		const files = scaffold(options);
		const known = (name: string, range: string) => {
			const pinnedAs = SAME_VERSION_AS[name] ?? name;
			return [DEPENDENCY_VERSIONS, TOOLCHAIN_VERSIONS, EXPO_VERSIONS].some(
				(group) =>
					Object.entries(group).some(
						([key, value]) =>
							value === range &&
							(key === pinnedAs || key.startsWith(`${pinnedAs}@`)),
					),
			);
		};

		const manifests = files.filter((f) => f.path.endsWith('package.json'));
		expect(manifests.length).toBeGreaterThan(0);

		for (const { path, content } of manifests) {
			const pkg = JSON.parse(content);
			for (const field of FIELDS) {
				for (const [name, range] of Object.entries<string>(pkg[field] ?? {})) {
					if (
						name.startsWith('@geekmidas/') ||
						range.startsWith('workspace:')
					) {
						continue;
					}
					expect(known(name, range), `${path} ${field}.${name} ${range}`).toBe(
						true,
					);
				}
			}
		}

		// A lookup inside a template string would print its own source.
		for (const { path, content } of files) {
			expect(content, path).not.toMatch(/_VERSIONS\[/);
		}
	});
});

describe('the templates and generators', () => {
	it('write no third-party version literal of their own', () => {
		// `'name': '~1.2.3'`, `name: '^1.2.3'`, or `deps['name'] = '~1.2.3'`,
		// outside a package's own `version` and the `@geekmidas` pins
		// versions.ts owns.
		const literal =
			/(?:'(@?[a-z0-9@/._-]+)'\]? *[:=]|\b([a-z][a-z0-9-]*):) '[~^]?\d+\.\d+/g;
		const dir = join(__dirname, '..');
		const offenders: string[] = [];

		for (const sub of ['templates', 'generators']) {
			for (const file of readdirSync(join(dir, sub))) {
				if (!file.endsWith('.ts')) continue;
				const source = readFileSync(join(dir, sub, file), 'utf-8');
				for (const match of source.matchAll(literal)) {
					const name = match[1] ?? match[2];
					if (name === 'version' || name?.startsWith('@geekmidas/')) continue;
					offenders.push(`${sub}/${file}: ${match[0]}`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});

describe('turbo', () => {
	it('is 2.4 or later, which expands $TURBO_ROOT$', () => {
		const [major, minor] = DEPENDENCY_VERSIONS.turbo
			.replace(/^[~^]/, '')
			.split('.')
			.map(Number);
		expect(major! > 2 || (major === 2 && minor! >= 4)).toBe(true);
	});

	it('hashes the root constructs and config into every build, from the root', () => {
		const files = scaffold(SHAPES[4]![1]);
		const turbo = JSON.parse(
			files.find((f) => f.path === 'turbo.json')!.content,
		);

		expect(turbo.tasks.build.inputs).toEqual([
			'$TURBO_DEFAULT$',
			'$TURBO_ROOT$/constructs/**/*.ts',
			'$TURBO_ROOT$/gkm.config.ts',
		]);
		// No per-app turbo.json: the root's task config covers every package.
		expect(files.filter((f) => f.path.endsWith('/turbo.json'))).toEqual([]);
	});
});
