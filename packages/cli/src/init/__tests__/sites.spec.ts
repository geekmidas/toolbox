import { describe, expect, it } from 'vitest';
import { DEPENDENCY_VERSIONS, EXPO_VERSIONS } from '../dependencies.js';
import { generateSiteFiles } from '../generators/sites.js';
import type {
	FullstackFrontendFramework,
	TemplateOptions,
} from '../templates/index.js';

const options = (
	frontendFramework: FullstackFrontendFramework,
	mobileApp = false,
): TemplateOptions => ({
	name: 'shop',
	template: 'fullstack',
	telescope: true,
	loggerType: 'pino',
	routesStructure: 'centralized-endpoints',
	monorepo: true,
	apiPath: 'apps/api',
	packageManager: 'pnpm',
	deployTarget: 'none',
	stages: { local: 'dev', deployed: ['production'], protected: ['production'] },
	constructs: { database: true, cache: false, uploads: false, mail: true },
	frontendFramework,
	mobileApp,
});

const contentOf = (
	files: { path: string; content: string }[],
	path: string,
) => {
	const file = files.find((f) => f.path === path);
	if (!file) throw new Error(`${path} was not generated`);
	return file.content;
};

/** Where each framework puts a site's pages, and its root component. */
const layout = {
	nextjs: {
		pages: (dir: string) => [
			`${dir}/src/app/page.tsx`,
			`${dir}/src/app/login/page.tsx`,
			`${dir}/src/app/signing-in/page.tsx`,
		],
		providers: (dir: string) => `${dir}/src/app/providers.tsx`,
		variant: "variant: 'next'",
	},
	'tanstack-start': {
		pages: (dir: string) => [
			`${dir}/src/routes/index.tsx`,
			`${dir}/src/routes/login.tsx`,
			`${dir}/src/routes/signing-in.tsx`,
		],
		providers: (dir: string) => `${dir}/src/routes/__root.tsx`,
		variant: "variant: 'tanstack'",
	},
} as const;

describe('generateSiteFiles', () => {
	it('writes nothing outside the fullstack template', () => {
		expect(
			generateSiteFiles({ ...options('nextjs'), template: 'api' }),
		).toEqual([]);
	});

	describe.each(['nextjs', 'tanstack-start'] as const)('%s', (framework) => {
		const files = generateSiteFiles(options(framework));
		const paths = files.map((f) => f.path);

		it('declares the web site at the root domain and the admin panel beside it', () => {
			const site = contentOf(files, 'constructs/site.ts');
			const admin = contentOf(files, 'constructs/admin.ts');

			expect(site).toContain("new StaticSite('Web'");
			expect(site).toContain('root: true');
			expect(site).toContain(layout[framework].variant);
			expect(site).toContain('.dependsOn([api, auth])');
			expect(admin).toContain("new StaticSite('Admin'");
			expect(admin).toContain("path: 'apps/admin'");
			expect(admin).toContain(layout[framework].variant);
			expect(admin).toContain('.dependsOn([api, auth])');
		});

		it.each([
			'apps/web',
			'apps/admin',
		])('gives %s a home, /login and /signing-in', (dir) => {
			for (const page of layout[framework].pages(dir)) {
				expect(paths).toContain(page);
			}
			expect(paths).toContain(`${dir}/src/auth/login-form.tsx`);
			expect(paths).toContain(`${dir}/src/auth/signing-in.tsx`);
		});

		it.each([
			'apps/web',
			'apps/admin',
		])('wraps %s in the shared AuthProvider, with its own auth client', (dir) => {
			const root = contentOf(files, layout[framework].providers(dir));
			expect(root).toContain(
				"import { AuthProvider } from '@shop/auth/client'",
			);
			expect(root).toContain('<AuthProvider client={authClient}>');

			const client = contentOf(files, `${dir}/src/lib/auth-client.ts`);
			expect(client).toContain('magicLinkClient()');

			const pkg = JSON.parse(contentOf(files, `${dir}/package.json`));
			expect(pkg.dependencies['@shop/auth']).toBe('workspace:*');
		});

		it('asks for a link that comes back to the site it was asked from', () => {
			const form = contentOf(files, 'apps/admin/src/auth/login-form.tsx');

			expect(form).toContain('useRequestSignInLink');
			expect(form).toContain('/signing-in');
			expect(contentOf(files, 'apps/web/src/auth/signing-in.tsx')).toContain(
				'useSignInLinkResult',
			);
		});

		it('lets only admin.access past the admin panel', () => {
			const gate = contentOf(files, 'apps/admin/src/auth/staff-gate.tsx');

			expect(gate).toContain("api('GET /profiles/me')");
			expect(gate).toContain("permissions.includes('admin.access')");
			expect(paths).not.toContain('apps/web/src/auth/staff-gate.tsx');
		});

		it('names each package after its app', () => {
			expect(JSON.parse(contentOf(files, 'apps/web/package.json')).name).toBe(
				'@shop/web',
			);
			expect(JSON.parse(contentOf(files, 'apps/admin/package.json')).name).toBe(
				'@shop/admin',
			);
		});

		it.each([
			[false, DEPENDENCY_VERSIONS.react],
			[true, EXPO_VERSIONS.react],
		])('runs the workspace React (mobile app: %s)', (mobileApp, react) => {
			const sites = generateSiteFiles(options(framework, mobileApp));
			for (const dir of ['apps/web', 'apps/admin']) {
				const pkg = JSON.parse(contentOf(sites, `${dir}/package.json`));
				expect(pkg.dependencies.react).toBe(react);
				expect(pkg.dependencies['react-dom']).toBe(react);
			}
		});
	});

	it('has Next transpile the workspace packages it imports as TypeScript', () => {
		const files = generateSiteFiles(options('nextjs'));

		for (const dir of ['apps/web', 'apps/admin']) {
			const config = contentOf(files, `${dir}/next.config.ts`);
			expect(config).toContain(
				"transpilePackages: ['@shop/models', '@shop/auth']",
			);
		}
	});

	it('sends the session cookie with every API request', () => {
		for (const framework of ['nextjs', 'tanstack-start'] as const) {
			const files = generateSiteFiles(options(framework));
			expect(contentOf(files, 'apps/admin/src/api/index.ts')).toContain(
				"credentials: 'include'",
			);
		}
	});
});
