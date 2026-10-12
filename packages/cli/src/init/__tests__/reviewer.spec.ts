import { describe, expect, it } from 'vitest';
import { generateReviewerAppFiles } from '../generators/reviewer.js';
import type { RoutesStructure, TemplateOptions } from '../templates/index.js';

const options: TemplateOptions = {
	stages: { local: 'dev', deployed: ['production'] },
	name: 'shop',
	template: 'fullstack',
	telescope: true,
	loggerType: 'pino',
	routesStructure: 'centralized-endpoints',
	monorepo: true,
	apiPath: 'apps/api',
	packageManager: 'pnpm',
	deployTarget: 'compose',
	constructs: { database: true, cache: false, mail: true, uploads: false },
	frontendFramework: 'nextjs',
	mobileApp: true,
};

const fileAt = (files: { path: string; content: string }[], path: string) =>
	files.find((file) => file.path === path)?.content;

describe('generateReviewerAppFiles', () => {
	it('writes nothing without a mobile app: there is no store to review it', () => {
		expect(generateReviewerAppFiles({ ...options, mobileApp: false })).toEqual(
			[],
		);
		expect(generateReviewerAppFiles({ ...options, template: 'api' })).toEqual(
			[],
		);
	});

	it('declares the site, its password and the key its cookie is sealed with', () => {
		const constructs = fileAt(
			generateReviewerAppFiles(options),
			'constructs/reviewer.ts',
		)!;

		expect(constructs).toContain("new RestApi('Reviewer', {");
		expect(constructs).toContain("subdomain: 'reviewer'");
		expect(constructs).toContain("new RandomPassword('ReviewerPassword', {");
		expect(constructs).toContain("new Encryption('ReviewerSessions')");
		// Generated, never set: no credential and no fake for it.
		expect(constructs).not.toContain('Credential');
	});

	it('reads the links from the auth schema and the reviewers from the shared auth package', () => {
		const files = generateReviewerAppFiles(options);

		expect(fileAt(files, 'apps/reviewer/src/router.ts')).toContain(
			'reviewer.database(authDatabase)',
		);
		expect(fileAt(files, 'apps/reviewer/src/links.ts')).toContain(
			".selectFrom('reviewer_links')",
		);
		expect(fileAt(files, 'apps/reviewer/src/pages.ts')).toContain(
			"from '@shop/auth/reviewers'",
		);
		const pkg = JSON.parse(fileAt(files, 'apps/reviewer/package.json')!);
		expect(pkg.name).toBe('@shop/reviewer');
		expect(pkg.dependencies['@shop/auth']).toBe('workspace:*');
		expect(pkg.imports['#test']).toBe('./.gkm/test/index.ts');
	});

	it('keeps the site’s defences: sealed cookie, constant-time compare, rate limit, CSP', () => {
		const files = generateReviewerAppFiles(options);
		const session = fileAt(files, 'apps/reviewer/src/session.ts')!;
		const login = fileAt(
			files,
			'apps/reviewer/src/endpoints/sessions/createSession.ts',
		)!;

		expect(session).toContain('timingSafeEqual');
		expect(session).toContain('cipher.encrypt(');
		expect(session).toContain('httpOnly: true');
		expect(login).toContain('.rateLimit({');
		expect(login).toContain('.dependsOn([reviewerPassword, reviewerSessions])');
		expect(fileAt(files, 'apps/reviewer/src/pages.ts')).toContain(
			'"default-src \'none\'"',
		);
	});

	it.each([
		['centralized-endpoints', 'src/endpoints/links/getPlatforms.ts'],
		['centralized-routes', 'src/routes/links/getPlatforms.ts'],
		['domain-based', 'src/links/routes/getPlatforms.ts'],
	] as [
		RoutesStructure,
		string,
	][])('puts its routes where the %s glob finds them', (routesStructure, path) => {
		const files = generateReviewerAppFiles({ ...options, routesStructure });

		expect(fileAt(files, `apps/reviewer/${path}`)).toContain(
			"from '../../router.ts'",
		);
	});

	it('ships feature tests that read the stage’s own password', () => {
		const files = generateReviewerAppFiles(options);
		const spec = fileAt(files, 'apps/reviewer/__tests__/sessions.spec.ts')!;

		expect(spec).toContain("from '#test'");
		expect(spec).toContain("services.get('reviewerPassword')");
		expect(fileAt(files, 'apps/reviewer/__tests__/links.spec.ts')).toContain(
			'mailbox(ios.email).all()',
		);
	});

	it('names the product as the project it was scaffolded for', () => {
		const pages = fileAt(
			generateReviewerAppFiles(options),
			'apps/reviewer/src/pages.ts',
		);

		expect(pages).toContain(options.name);
	});
});
