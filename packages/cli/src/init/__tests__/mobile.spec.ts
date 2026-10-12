import { describe, expect, it } from 'vitest';
import { generateExpoAppFiles } from '../generators/mobile-expo.js';
import type { GeneratedFile, TemplateOptions } from '../templates/index.js';

const fullstack: TemplateOptions = {
	name: 'shop',
	template: 'fullstack',
	telescope: true,
	loggerType: 'pino',
	routesStructure: 'centralized-endpoints',
	monorepo: true,
	apiPath: 'apps/api',
	packageManager: 'pnpm',
	deployTarget: 'dokploy',
	stages: { local: 'dev', deployed: ['prod'] },
	constructs: { database: true, cache: false, uploads: false, mail: true },
	frontendFramework: 'nextjs',
	mobileApp: true,
};

const file = (files: GeneratedFile[], path: string) => {
	const found = files.find((f) => f.path === path);
	if (!found) throw new Error(`${path} was not generated`);
	return found.content;
};

describe('generateExpoAppFiles', () => {
	it('writes nothing without a mobile app', () => {
		expect(generateExpoAppFiles({ ...fullstack, mobileApp: false })).toEqual(
			[],
		);
		expect(
			generateExpoAppFiles({ ...fullstack, mobileApp: undefined }),
		).toEqual([]);
		expect(
			generateExpoAppFiles({
				...fullstack,
				template: 'api',
				monorepo: false,
			}),
		).toEqual([]);
	});

	it('declares the app with an edge to the API, the auth server and the mailer', () => {
		const app = file(generateExpoAppFiles(fullstack), 'constructs/app.ts');

		expect(app).toContain("new MobileApp('App', { path: 'apps/app' })");
		expect(app).toMatch(/\.dependsOn\(\[\s*api,\s*auth,\s*email,\s*\]\)/);
		expect(app).toContain("import { email } from './email.ts';");
	});

	it('signs in through the routes an emailed link needs, and no other', () => {
		const paths = generateExpoAppFiles(fullstack).map((f) => f.path);

		expect(paths).toEqual(
			expect.arrayContaining([
				'apps/app/app/_layout.tsx',
				'apps/app/app/+native-intent.tsx',
				'apps/app/app/index.tsx',
				'apps/app/app/(auth)/_layout.tsx',
				'apps/app/app/(auth)/continue.tsx',
				'apps/app/app/(auth)/check-email.tsx',
				'apps/app/app/signing-in.tsx',
				'apps/app/components/email-link-form.tsx',
				'apps/app/lib/auth-client.ts',
				'apps/app/lib/opened-link.ts',
			]),
		);
		// The old screen that asked for a link and stored the cookie itself.
		expect(paths).not.toContain('apps/app/app/login.tsx');
	});

	it('keeps every incoming link as it arrived, before the router decodes it', () => {
		const files = generateExpoAppFiles(fullstack);
		const intent = file(files, 'apps/app/app/+native-intent.tsx');
		const opened = file(files, 'apps/app/lib/opened-link.ts');
		const signingIn = file(files, 'apps/app/app/signing-in.tsx');

		expect(intent).toContain('export function redirectSystemPath(');
		expect(intent).toContain('rememberLink(path);');
		// Only a sign-in link, judged by the route the auth package names.
		expect(opened).toContain(
			"import { LINK_ROUTE } from '@shop/auth/magic-link';",
		);
		expect(opened).toContain('path === LINK_ROUTE');
		// The screen reads the kept link, not the router's decoded params.
		expect(signingIn).toContain('openedLink()');
		expect(signingIn).toContain('landing(linkParams(link))');
		expect(signingIn).not.toContain('useLocalSearchParams');
	});

	it('keeps the session the link brought, merged into what the Expo client holds', () => {
		const files = generateExpoAppFiles(fullstack);
		const authClient = file(files, 'apps/app/lib/auth-client.ts');
		const signingIn = file(files, 'apps/app/app/signing-in.tsx');

		expect(authClient).toContain('getSetCookie(cookie, previous ?? undefined)');
		expect(authClient).toContain("authClient.$store.notify('$sessionSignal')");
		expect(authClient).toContain('magicLinkClient()');
		expect(signingIn).toContain('await keepSessionFromLink(cookie);');
	});

	it('wires the shared provider, so screens sign in through the auth package', () => {
		const files = generateExpoAppFiles(fullstack);
		const layout = file(files, 'apps/app/app/_layout.tsx');
		const form = file(files, 'apps/app/components/email-link-form.tsx');
		const pkg = JSON.parse(file(files, 'apps/app/package.json'));

		expect(layout).toContain(
			"import { AuthProvider, useSession } from '@shop/auth/client';",
		);
		expect(layout).toContain('<AuthProvider client={authClient}>');
		// Signing in stays reachable whatever the session says.
		expect(layout).toContain('<Stack.Protected guard={!signedIn}>');
		expect(layout).toMatch(
			/<\/Stack.Protected>\s*<Stack.Screen name="signing-in" \/>/,
		);
		expect(form).toContain('useRequestSignInLink({');
		expect(form).toContain('callbackURL: LINK_ROUTE');
		expect(pkg.dependencies['@shop/auth']).toBe('workspace:*');
	});

	it("opens the local stage's inbox from Check your email, under the key the mailer publishes", () => {
		const files = generateExpoAppFiles(fullstack);
		const config = file(files, 'apps/app/config.ts');
		const checkEmail = file(files, 'apps/app/app/(auth)/check-email.tsx');

		// `Email('Mail')` publishes `MAIL_INBOX_URL`, inlined as EXPO_PUBLIC_.
		expect(config).toContain('process.env.EXPO_PUBLIC_MAIL_INBOX_URL');
		expect(checkEmail).toContain('inboxUrl: config.mailerInboxUrl');
	});

	it('writes no escape a generated file would keep', () => {
		for (const { path, content } of generateExpoAppFiles(fullstack)) {
			if (path.endsWith('.json')) continue;
			expect(content, path).not.toMatch(/\\`|\\\$\{/);
		}
	});
});
