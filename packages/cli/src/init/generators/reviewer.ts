import { DEPENDENCY_VERSIONS, TOOLCHAIN_VERSIONS } from '../dependencies.js';
import type {
	GeneratedFile,
	RoutesStructure,
	TemplateOptions,
} from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * The site App Store and Play Store reviewers sign in to the mobile app
 * through.
 *
 * A reviewer has no inbox, so a sign-in link asked for one of the reviewer
 * addresses (`@<name>/auth/reviewers`) is never mailed: the auth server keeps
 * it in `reviewer_links`, and this site shows it to whoever has the stage's
 * password — a `RandomPassword`, generated on the stage's first deploy and
 * read back with `gkm secrets:show`. Only with a mobile app: without one
 * there is no store to review it.
 */
export function generateReviewerAppFiles(
	options: TemplateOptions,
): GeneratedFile[] {
	if (
		!options.monorepo ||
		options.template !== 'fullstack' ||
		!options.mobileApp
	) {
		return [];
	}

	const scope = `@${options.name}`;
	const route = (domain: string, file: string) =>
		`apps/reviewer/${routeFile(options.routesStructure, domain, file)}`;

	return [
		{ path: 'constructs/reviewer.ts', content: reviewerConstructs() },
		{
			path: 'apps/reviewer/package.json',
			content: `${JSON.stringify(packageJson(options), null, 2)}\n`,
		},
		{
			path: 'apps/reviewer/tsconfig.json',
			content: `${JSON.stringify(tsConfig(options), null, 2)}\n`,
		},
		{ path: 'apps/reviewer/vitest.config.ts', content: VITEST_CONFIG },
		{ path: 'apps/reviewer/.gitignore', content: GITIGNORE },
		{ path: 'apps/reviewer/src/router.ts', content: routerTs(scope) },
		{ path: 'apps/reviewer/src/session.ts', content: SESSION_TS },
		{ path: 'apps/reviewer/src/links.ts', content: linksTs(scope) },
		{ path: 'apps/reviewer/src/pages.ts', content: pagesTs(options.name) },
		{ path: route('health', 'getHealth.ts'), content: GET_HEALTH },
		{ path: route('links', 'getPlatforms.ts'), content: GET_PLATFORMS },
		{
			path: route('links', 'getPlatformLink.ts'),
			content: getPlatformLink(scope),
		},
		{
			path: route('sessions', 'createSession.ts'),
			content: createSession(scope),
		},
		{ path: route('sessions', 'deleteSession.ts'), content: DELETE_SESSION },
		{
			path: 'apps/reviewer/__tests__/__helpers__/site.ts',
			content: siteHelpers(scope),
		},
		{
			path: 'apps/reviewer/__tests__/sessions.spec.ts',
			content: SESSIONS_SPEC,
		},
		{
			path: 'apps/reviewer/__tests__/links.spec.ts',
			content: linksSpec(scope),
		},
	];
}

/**
 * Where a route file sits, so the workspace's `constructs` glob — laid out
 * the way `init` was told — finds it. Every layout puts a route two folders
 * below `src/`, so its relative imports are the same in all three.
 */
function routeFile(
	structure: RoutesStructure,
	domain: string,
	file: string,
): string {
	switch (structure) {
		case 'centralized-endpoints':
			return `src/endpoints/${domain}/${file}`;
		case 'centralized-routes':
			return `src/routes/${domain}/${file}`;
		case 'domain-based':
			return `src/${domain}/routes/${file}`;
	}
}

function packageJson(options: TemplateOptions) {
	return {
		name: `@${options.name}/reviewer`,
		version: '0.0.1',
		private: true,
		type: 'module',
		scripts: {
			dev: 'gkm dev',
			build: 'gkm build',
			test: 'vitest',
			'test:once': 'vitest run',
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			[`@${options.name}/auth`]: 'workspace:*',
			'@geekmidas/cache': GEEKMIDAS_VERSIONS['@geekmidas/cache'],
			'@geekmidas/constructs': GEEKMIDAS_VERSIONS['@geekmidas/constructs'],
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@geekmidas/errors': GEEKMIDAS_VERSIONS['@geekmidas/errors'],
			'@geekmidas/logger': GEEKMIDAS_VERSIONS['@geekmidas/logger'],
			'@geekmidas/rate-limit': GEEKMIDAS_VERSIONS['@geekmidas/rate-limit'],
			'@geekmidas/services': GEEKMIDAS_VERSIONS['@geekmidas/services'],
			'@geekmidas/telescope': GEEKMIDAS_VERSIONS['@geekmidas/telescope'],
			'@hono/node-server': DEPENDENCY_VERSIONS['@hono/node-server'],
			hono: DEPENDENCY_VERSIONS.hono,
			kysely: DEPENDENCY_VERSIONS.kysely,
			pg: DEPENDENCY_VERSIONS.pg,
			...(options.loggerType === 'pino'
				? { pino: DEPENDENCY_VERSIONS.pino }
				: {}),
			zod: DEPENDENCY_VERSIONS.zod,
		},
		devDependencies: {
			'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
			'@geekmidas/testkit': GEEKMIDAS_VERSIONS['@geekmidas/testkit'],
			'@types/node': DEPENDENCY_VERSIONS['@types/node'],
			'@types/pg': DEPENDENCY_VERSIONS['@types/pg'],
			// What the feature-test harness intercepts HTTP with.
			msw: DEPENDENCY_VERSIONS.msw,
			tsx: TOOLCHAIN_VERSIONS.tsx,
			typescript: TOOLCHAIN_VERSIONS.typescript,
			vitest: TOOLCHAIN_VERSIONS.vitest,
		},
		// The feature-test harness `gkm test` generates for this app.
		imports: { '#test': './.gkm/test/index.ts' },
	};
}

function tsConfig(options: TemplateOptions) {
	return {
		extends: '../../tsconfig.json',
		compilerOptions: {
			noEmit: true,
			allowImportingTsExtensions: true,
			paths: {
				// Not this app's: its own code imports relatively. The test
				// harness (`.gkm/test`) imports every app's handlers, and the
				// API's say `~/`.
				'~/*': [`../../${options.apiPath}/src/*`],
				[`@${options.name}/constructs/*`]: ['../../constructs/*'],
				[`@${options.name}/*`]: ['../../packages/*/src'],
			},
		},
		// `.gkm/stages.d.ts` types stage names from gkm.config.ts; a dot
		// folder is never matched by a wildcard, so it is named.
		include: ['src/**/*.ts', '__tests__/**/*.ts', '../../.gkm/stages.d.ts'],
		exclude: ['node_modules', 'dist'],
	};
}

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite resolves tsconfig \`paths\` itself; no plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/.gkm/**'],
  },
});
`;

const GITIGNORE = `node_modules/
dist/
.gkm/
*.log
`;

function reviewerConstructs(): string {
	return `import { Encryption } from '@geekmidas/constructs/encryption';
import { RandomPassword } from '@geekmidas/constructs/random-password';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { logger } from './logger.ts';

/**
 * The password App Store and Play Store reviewers are given for the reviewer
 * site, in the app's review notes. Nobody sets it: \`gkm dev\` and \`gkm test\`
 * derive it, and a deployed stage generates it on its first deploy and keeps
 * it. Read it with \`gkm secrets:show --stage <stage>\` (\`REVIEWER_PASSWORD\`).
 *
 * Letters and digits only: a reviewer types it from the notes.
 */
export const reviewerPassword = new RandomPassword('ReviewerPassword', {
  length: 24,
  symbols: '',
});

/**
 * The key the reviewer site's session cookie is sealed with: the cookie is
 * an AES-256-GCM ciphertext of when it expires, so it cannot be forged or
 * altered without the key. Nothing to set: derived for \`gkm dev\` and
 * \`gkm test\`, generated into a deployed stage's secrets on its first deploy.
 */
export const reviewerSessions = new Encryption('ReviewerSessions');

/**
 * The reviewer site: where a store reviewer, who has no inbox, finds the
 * sign-in link the app asked to have sent to their reviewer account
 * (\`packages/auth/src/reviewers.ts\`). It reads \`reviewer_links\` in the auth
 * schema and nothing else, behind one shared password.
 *
 * It answers on \`reviewer.<domain>\`.
 */
export const reviewer = new RestApi('Reviewer', {
  path: 'apps/reviewer',
  subdomain: 'reviewer',
  // Its pages check the session cookie themselves (\`apps/reviewer/src/session.ts\`):
  // there is no bearer token for an authorizer to read.
  defaultAuthorizer: 'none',
  logger,
});
`;
}

function routerTs(scope: string): string {
	return `import { authDatabase } from '${scope}/constructs/database.ts';
import { reviewer } from '${scope}/constructs/reviewer.ts';

/**
 * Every page of the reviewer site: the auth schema as \`db\`, where the auth
 * server keeps each reviewer's latest sign-in link (\`reviewer_links\`). The
 * app's own database is never read here.
 */
export const router = reviewer.database(authDatabase);
`;
}

const SESSION_TS = `import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type Cipher,
  CiphertextMalformed,
  CiphertextNotAuthentic,
  EncryptionKeyRetired,
} from '@geekmidas/constructs/encryption';
import { z } from 'zod';

/** The cookie a signed-in reviewer carries. */
export const SESSION_COOKIE = 'reviewer_session';

/** How long a sign-in to the reviewer site lasts. */
export const SESSION_HOURS = 24;

/**
 * How often one address can try the password: 10 in 15 minutes. Counted in
 * the process, which is the one reviewer container a stage runs.
 */
export const LOGIN_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

const HOUR_MS = 60 * 60 * 1000;

/**
 * What the cookie seals: what it is for, so no other ciphertext of the same
 * key passes for one, and when it stops working.
 */
const SessionSchema = z.object({
  purpose: z.literal('reviewer-session'),
  expiresAt: z.number(),
});

/**
 * Whether \`given\` is the password, in time that does not depend on how much
 * of it is right: both are hashed to 32 bytes first, so \`timingSafeEqual\`
 * compares equal lengths and the length of the password does not leak
 * either.
 */
export function passwordMatches(given: string, password: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(password));
}

/**
 * A new session's cookie value: sealed with the stage's \`ReviewerSessions\`
 * key (AES-256-GCM), so it cannot be made or changed without the key.
 */
export async function sealSession(
  cipher: Cipher,
  now = Date.now(),
): Promise<string> {
  return cipher.encrypt(
    JSON.stringify({
      purpose: 'reviewer-session',
      expiresAt: now + SESSION_HOURS * HOUR_MS,
    } satisfies z.input<typeof SessionSchema>),
  );
}

/**
 * Whether \`cookie\` is a session this site sealed that has not expired.
 * Anything else — missing, made up, altered, sealed under a retired key or
 * by another construct — is no session at all.
 */
export async function hasSession(
  cipher: Cipher,
  cookie: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!cookie) return false;

  let sealed: string;
  try {
    sealed = await cipher.decrypt(cookie);
  } catch (error) {
    if (
      error instanceof CiphertextMalformed ||
      error instanceof CiphertextNotAuthentic ||
      error instanceof EncryptionKeyRetired
    ) {
      return false;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sealed);
  } catch {
    return false;
  }
  const session = SessionSchema.safeParse(parsed);
  return session.success && session.data.expiresAt > now;
}

/** The cookie's attributes: never readable by a script, sent same-site. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  // Every stage is served over HTTPS, local ones through Caddy included.
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_HOURS * 60 * 60,
} as const;
`;

function linksTs(scope: string): string {
	return `import type { AuthDatabase } from '${scope}/constructs/database.ts';
import type { Reviewer } from '${scope}/auth/reviewers';
import type { Kysely } from 'kysely';

/**
 * \`reviewer\`'s newest sign-in link that has not expired, if any. A link that
 * was already used is still shown until it expires: whether Better Auth has
 * consumed it is not this table's to know, and the page says to ask again.
 */
export async function latestLink(
  db: Kysely<AuthDatabase>,
  reviewer: Reviewer,
  now = new Date(),
): Promise<{ url: string; expiresAt: Date } | undefined> {
  return db
    .selectFrom('reviewer_links')
    .select(['url', 'expires_at as expiresAt'])
    .where('email', '=', reviewer.email)
    .where('expires_at', '>', now)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
}
`;
}

function pagesTs(name: string): string {
	return `import { createHash } from 'node:crypto';
import { REVIEWERS, type Reviewer } from '@${name}/auth/reviewers';

/** The product, as the pages name it. */
const PRODUCT = ${JSON.stringify(name)};

/** Text made safe to put in HTML, in an element or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The page's one script: Copy puts the link on the clipboard. Inline, and
 * allowed by its hash alone (\`CONTENT_SECURITY_POLICY\`), so nothing else
 * can run on a page that shows a sign-in link.
 */
const SCRIPT = \`document.querySelectorAll('[data-copy]').forEach(function (button) {
  button.addEventListener('click', function () {
    navigator.clipboard.writeText(button.getAttribute('data-copy')).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy link'; }, 2000);
    });
  });
});\`;

const SCRIPT_HASH = createHash('sha256').update(SCRIPT).digest('base64');

/**
 * Nothing loads from anywhere: the styles are inline, the one script is
 * allowed by its hash, forms post only here, and no other site can frame it.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  \`script-src 'sha256-\${SCRIPT_HASH}'\`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * The headers on every page: never cached (a page may show a sign-in link),
 * never indexed, never framed, and no referrer sent when a link is opened.
 */
export const PAGE_HEADERS = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
} as const;

/** A plain dark theme. Yours to make the product's. */
const STYLE = \`
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#0b0c0e;color:#f4f5f7;
  font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
  display:flex;align-items:center;justify-content:center;padding:24px}
main{width:100%;max-width:440px;background:#131418;border:1px solid #2a2c33;
  border-radius:20px;padding:32px}
.brand{font-weight:700;letter-spacing:.02em;color:#8ab4ff;margin:0 0 24px}
h1{font-size:24px;line-height:1.25;margin:0 0 8px}
p{color:#a7abb5;margin:0 0 16px}
.stack{display:grid;gap:12px}
.button{display:block;width:100%;padding:14px 16px;border-radius:12px;border:0;
  font:inherit;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}
.primary{background:#8ab4ff;color:#0b0c0e}
.secondary{background:#1d1f25;color:#f4f5f7;border:1px solid #393c45}
label{display:block;font-weight:600;margin-bottom:6px}
input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid #393c45;
  background:#0b0c0e;color:#f4f5f7;font:inherit;margin-bottom:16px}
input:focus{outline:2px solid #8ab4ff;outline-offset:1px}
.error{color:#ff8a80}
.email{color:#f4f5f7;font-weight:600}
.link{word-break:break-all;background:#0b0c0e;border:1px solid #2a2c33;
  border-radius:12px;padding:12px;font:13px/1.4 ui-monospace,monospace;
  color:#a7abb5;margin:0 0 16px}
footer{margin-top:24px;display:flex;justify-content:space-between;font-size:14px}
footer a{color:#868b96}
\`;

/** A whole page around \`body\`. */
function layout(title: string, body: string, script = false): string {
  return \`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>\${escapeHtml(title)} · \${escapeHtml(PRODUCT)} review</title>
<style>\${STYLE}</style>
</head>
<body>
<main>
<p class="brand">\${escapeHtml(PRODUCT)} · App review</p>
\${body}
</main>
\${script ? \`<script>\${SCRIPT}</script>\` : ''}
</body>
</html>\`;
}

/** \`/\`: which platform the reviewer is reviewing. */
export function choosePage(): string {
  return layout(
    'Choose a platform',
    \`<h1>Sign-in links for app review</h1>
<p>Choose the platform you are reviewing.</p>
<div class="stack">
\${REVIEWERS.map(
  (reviewer) =>
    \`<a class="button primary" href="/\${reviewer.platform}">\${escapeHtml(reviewer.label)} (\${escapeHtml(reviewer.store)})</a>\`,
).join('\\n')}
</div>\`,
  );
}

/** \`/:platform\` before signing in: the reviewer password. */
export function loginPage(reviewer: Reviewer, error: boolean): string {
  return layout(
    \`\${reviewer.label} review\`,
    \`<h1>\${escapeHtml(reviewer.label)} review</h1>
<p>Enter the password from the review notes.</p>
\${error ? '<p class="error" role="alert">That password is not right.</p>' : ''}
<form method="post" action="/login">
<input type="hidden" name="platform" value="\${escapeHtml(reviewer.platform)}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button class="button primary" type="submit">Continue</button>
</form>
<footer><a href="/">Back</a></footer>\`,
  );
}

/**
 * \`/:platform\` signed in: the newest link the app asked for, to copy or
 * open, or how to get one.
 */
export function linkPage(
  reviewer: Reviewer,
  link: { url: string; expiresAt: Date } | undefined,
  now = new Date(),
): string {
  const howTo = \`In the \${escapeHtml(PRODUCT)} app, enter <span class="email">\${escapeHtml(reviewer.email)}</span> as your email and ask for a sign-in link. Then refresh this page.\`;

  const body = link
    ? \`<h1>Your sign-in link</h1>
<p>For <span class="email">\${escapeHtml(reviewer.email)}</span>. It works once, and expires in \${minutesUntil(link.expiresAt, now)}.</p>
<p class="link" id="link">\${escapeHtml(link.url)}</p>
<div class="stack">
<a class="button primary" href="\${escapeHtml(link.url)}" rel="noreferrer">Open link</a>
<button class="button secondary" type="button" data-copy="\${escapeHtml(link.url)}">Copy link</button>
<a class="button secondary" href="/\${reviewer.platform}">Refresh</a>
</div>
<p style="margin-top:16px">Used it already, or it expired? \${howTo}</p>\`
    : \`<h1>No sign-in link yet</h1>
<p>\${howTo}</p>
<div class="stack">
<a class="button primary" href="/\${reviewer.platform}">Refresh</a>
</div>\`;

  return layout(
    \`\${reviewer.label} review\`,
    \`\${body}
<footer><a href="/">Platforms</a><a href="/logout">Sign out</a></footer>\`,
    Boolean(link),
  );
}

function minutesUntil(at: Date, now: Date): string {
  const minutes = Math.max(
    1,
    Math.ceil((at.getTime() - now.getTime()) / 60000),
  );
  return minutes === 1 ? '1 minute' : \`\${minutes} minutes\`;
}
`;
}

const GET_HEALTH = `import { z } from 'zod';
import { router } from '../../router.ts';

export const getHealth = router
  .get('/health')
  .output(
    z
      .object({ status: z.string(), timestamp: z.string() })
      .meta({ id: 'ReviewerHealth' }),
  )
  .handle(async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
`;

const GET_PLATFORMS = `import { z } from 'zod';
import { choosePage, PAGE_HEADERS } from '../../pages.ts';
import { router } from '../../router.ts';

/** \`/\`: iOS or Android. Nothing on it needs the password. */
export const getPlatforms = router
  .get('/')
  .output(z.string())
  .responseType('text/html')
  .handle(async (_, response) => {
    for (const [name, value] of Object.entries(PAGE_HEADERS)) {
      response.header(name, value);
    }
    return response.send(choosePage());
  });
`;

function getPlatformLink(scope: string): string {
	return `import { reviewerSessions } from '${scope}/constructs/reviewer.ts';
import { reviewerOn } from '${scope}/auth/reviewers';
import { z } from 'zod';
import { latestLink } from '../../links.ts';
import { linkPage, loginPage, PAGE_HEADERS } from '../../pages.ts';
import { router } from '../../router.ts';
import { hasSession, SESSION_COOKIE } from '../../session.ts';

/**
 * \`/ios\`, \`/android\`: the password form, or, signed in, the newest sign-in
 * link the app asked for that platform's reviewer account that still works.
 * Any other path goes back to \`/\`.
 */
export const getPlatformLink = router
  .get('/:platform')
  .params(z.object({ platform: z.string() }))
  .query(z.object({ error: z.literal('password').optional() }))
  .dependsOn([reviewerSessions])
  .output(z.string())
  .responseType('text/html')
  .handle(async ({ params, query, cookie, services, db }, response) => {
    const reviewer = reviewerOn(params.platform);
    if (!reviewer) return response.redirect('/');

    for (const [name, value] of Object.entries(PAGE_HEADERS)) {
      response.header(name, value);
    }

    const signedIn = await hasSession(
      services.reviewerSessions,
      cookie(SESSION_COOKIE),
    );
    if (!signedIn) {
      return response.send(loginPage(reviewer, query.error === 'password'));
    }

    return response.send(linkPage(reviewer, await latestLink(db, reviewer)));
  });
`;
}

function createSession(scope: string): string {
	return `import {
  reviewerPassword,
  reviewerSessions,
} from '${scope}/constructs/reviewer.ts';
import { reviewerOn } from '${scope}/auth/reviewers';
import { InMemoryCache } from '@geekmidas/cache/memory';
import { z } from 'zod';
import { router } from '../../router.ts';
import {
  LOGIN_LIMIT,
  passwordMatches,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  sealSession,
} from '../../session.ts';

/**
 * \`POST /login\`, the password form. Right, it sets the session cookie and
 * goes to the platform's page; wrong, back to the form saying so. Where it
 * goes is built from \`REVIEWERS\` alone, never from what was posted, so the
 * form cannot send anyone anywhere else.
 */
export const createSession = router
  .post('/login')
  .body(
    z
      .object({ platform: z.string(), password: z.string().max(1024) })
      .meta({ id: 'ReviewerLogin' }),
  )
  .rateLimit({
    ...LOGIN_LIMIT,
    cache: new InMemoryCache(),
    // The client's address as the edge forwards it: Caddy replaces whatever
    // \`X-Forwarded-For\` the client sent, so this cannot be chosen by them.
    keyGenerator: ({ header }) =>
      \`reviewer-login:\${header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}\`,
    message: 'Too many attempts. Try again in 15 minutes.',
  })
  .dependsOn([reviewerPassword, reviewerSessions])
  .output(z.string())
  .responseType('text/html')
  .handle(async ({ body, services }, response) => {
    const reviewer = reviewerOn(body.platform);
    if (!reviewer) return response.redirect('/');

    if (!passwordMatches(body.password, services.reviewerPassword)) {
      return response.redirect(\`/\${reviewer.platform}?error=password\`);
    }

    return response
      .cookie(
        SESSION_COOKIE,
        await sealSession(services.reviewerSessions),
        SESSION_COOKIE_OPTIONS,
      )
      .redirect(\`/\${reviewer.platform}\`);
  });
`;
}

const DELETE_SESSION = `import { z } from 'zod';
import { router } from '../../router.ts';
import { SESSION_COOKIE } from '../../session.ts';

/** \`/logout\`: forget the session cookie, back to \`/\`. */
export const deleteSession = router
  .get('/logout')
  .output(z.string())
  .responseType('text/html')
  .handle(async (_, response) =>
    response
      .header('cache-control', 'no-store')
      .deleteCookie(SESSION_COOKIE, { path: '/' })
      .redirect('/'),
  );
`;

function siteHelpers(scope: string): string {
	return `import type { ReviewerPlatform } from '${scope}/auth/reviewers';
import { expect } from 'vitest';

/** Where the reviewer site answers in the test stage. */
export const SITE = process.env.REVIEWER_URL!;

/** What a test's browser does here: \`fetch\`, with its cookies. */
type Browser = { fetch: typeof fetch };

/**
 * A client address of its own, for each run of the login form: the limit is
 * per address, so one test's attempts never count against another's.
 */
export function clientIp(): string {
  const byte = () => Math.floor(Math.random() * 254) + 1;
  return \`10.\${byte()}.\${byte()}.\${byte()}\`;
}

/** A page, as the browser gets it, without following a redirect. */
export function visit(browser: Browser, path: string): Promise<Response> {
  return browser.fetch(\`\${SITE}\${path}\`, { redirect: 'manual' });
}

/** Post the password form, as a browser posts it, from \`ip\`. */
export function postLogin(
  browser: Browser,
  fields: Record<string, string>,
  ip = clientIp(),
): Promise<Response> {
  return browser.fetch(\`\${SITE}/login\`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': ip,
    },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
}

/** Sign in to the site with the stage's password; the cookie is kept. */
export async function signInToSite(
  browser: Browser,
  password: string,
  platform: ReviewerPlatform = 'ios',
): Promise<Response> {
  const response = await postLogin(browser, { platform, password });
  expect(response.status).toBe(303);
  return response;
}

/** The sign-in link a page shows, if it shows one. */
export function linkOn(html: string): string | undefined {
  const found = /<p class="link" id="link">([^<]+)<\\/p>/.exec(html)?.[1];
  return found
    ?.replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
`;
}

const SESSIONS_SPEC = `import { it } from '#test';
import { describe, expect } from 'vitest';
import { LOGIN_LIMIT } from '../src/session.ts';
import {
  clientIp,
  postLogin,
  SITE,
  signInToSite,
  visit,
} from './__helpers__/site.ts';

/** The session cookie a response set, whole, with its attributes. */
const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('reviewer_session='));

/**
 * The reviewer site's password: one shared password, compared in constant
 * time, answered with a sealed session cookie, and tried at most
 * \`LOGIN_LIMIT\` times per address. The password is the stage's own
 * \`RandomPassword\`, derived for the test stage.
 */
describe('POST /login', () => {
  it('refuses a wrong password, and says so on the form', async ({
    browser,
  }) => {
    const response = await postLogin(browser, {
      platform: 'ios',
      password: 'not-the-password',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/ios?error=password');
    expect(sessionCookie(response)).toBeUndefined();

    const page = await visit(browser, '/ios?error=password');
    const html = await page.text();
    expect(html).toContain('That password is not right.');
    expect(html).toContain('name="password"');
  });

  it('takes the right password with a sealed, HttpOnly, Secure, Lax cookie for a day', async ({
    browser,
    services,
  }) => {
    const password = await services.get('reviewerPassword');

    const response = await signInToSite(browser, password, 'android');

    expect(response.headers.get('location')).toBe('/android');
    const cookie = sessionCookie(response)!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=86400');
    expect(cookie).toContain('Path=/');
    // Neither the password nor anything readable is in it.
    expect(cookie).not.toContain(password);
    expect(cookie).not.toContain('reviewer-session');

    const page = await visit(browser, '/android');
    expect(await page.text()).toContain('No sign-in link yet');
  });

  it('never sends the browser anywhere but its own pages', async ({
    browser,
    services,
  }) => {
    const password = await services.get('reviewerPassword');

    for (const platform of [
      'https://evil.example',
      '//evil.example',
      '/\\\\evil.example',
      'ios/../../evil',
      '',
    ]) {
      const response = await postLogin(browser, { platform, password });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  it(\`stops an address after \${LOGIN_LIMIT.limit} tries\`, async ({
    browser,
    services,
  }) => {
    const ip = clientIp();
    for (let i = 0; i < LOGIN_LIMIT.limit; i++) {
      const response = await postLogin(
        browser,
        { platform: 'ios', password: \`guess-\${i}\` },
        ip,
      );
      expect(response.status).toBe(303);
    }

    // The right password too: the limit counts tries, not wrong ones.
    const password = await services.get('reviewerPassword');
    const limited = await postLogin(browser, { platform: 'ios', password }, ip);
    expect(limited.status).toBe(429);
    expect(sessionCookie(limited)).toBeUndefined();

    // Another address is not held back.
    const other = await postLogin(browser, { platform: 'ios', password });
    expect(other.status).toBe(303);
    expect(other.headers.get('location')).toBe('/ios');
  });
});

describe('the session cookie', () => {
  /** Put \`value\` in the browser as the session cookie. */
  const carry = (
    browser: { jar: { setCookie(cookie: string, url: string): unknown } },
    value: string,
  ) =>
    browser.jar.setCookie(
      \`reviewer_session=\${value}; Path=/; Secure; HttpOnly\`,
      SITE,
    );

  /** Whether \`/ios\` shows the password form rather than a link page. */
  const asksForPassword = async (browser: { fetch: typeof fetch }) => {
    const html = await (await visit(browser, '/ios')).text();
    return html.includes('name="password"');
  };

  it('is refused when it is just a word', async ({ browser }) => {
    await carry(browser, 'authenticated');

    expect(await asksForPassword(browser)).toBe(true);
  });

  it('is refused once a byte of a real one is changed', async ({
    browser,
    services,
  }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));
    const [real] = await browser.jar.getCookies(SITE);
    expect(real?.key).toBe('reviewer_session');
    expect(await asksForPassword(browser)).toBe(false);

    const parts = real!.value.split('.');
    const payload = Buffer.from(parts.at(-1)!, 'base64url');
    payload[payload.length - 1]! ^= 1;
    await carry(
      browser,
      [...parts.slice(0, -1), payload.toString('base64url')].join('.'),
    );

    expect(await asksForPassword(browser)).toBe(true);
  });

  it('is refused when it has expired, though sealed with the right key', async ({
    browser,
    services,
  }) => {
    const sessions = await services.get('reviewerSessions');
    await carry(
      browser,
      await sessions.encrypt(
        JSON.stringify({
          purpose: 'reviewer-session',
          expiresAt: Date.now() - 1000,
        }),
      ),
    );

    expect(await asksForPassword(browser)).toBe(true);
  });

  it('is refused when it seals something else', async ({
    browser,
    services,
  }) => {
    const sessions = await services.get('reviewerSessions');
    await carry(
      browser,
      await sessions.encrypt(
        JSON.stringify({ purpose: 'other', expiresAt: Date.now() + 60_000 }),
      ),
    );

    expect(await asksForPassword(browser)).toBe(true);
  });

  it('is forgotten on /logout', async ({ browser, services }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));

    const response = await visit(browser, '/logout');

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(await asksForPassword(browser)).toBe(true);
  });
});
`;

function linksSpec(scope: string): string {
	return `import { it } from '#test';
import { MAGIC_LINK_MINUTES } from '${scope}/auth/magic-link';
import { REVIEWERS, reviewerOn } from '${scope}/auth/reviewers';
import { afterEach, describe, expect, vi } from 'vitest';
import { linkOn, signInToSite, visit } from './__helpers__/site.ts';

const ios = reviewerOn('ios')!;
const android = reviewerOn('android')!;

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Asking for a sign-in link as a store reviewer: the auth server keeps it
 * for the reviewer site instead of mailing an inbox nobody reads, and the
 * site shows it to whoever has the password.
 */
describe('a reviewer’s sign-in link', () => {
  it('is kept for the site, not emailed', async ({
    browser,
    services,
    mailbox,
  }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));

    const asked = await browser.auth.signIn.magicLink({ email: ios.email });
    expect(asked.error).toBeNull();

    const page = await visit(browser, '/ios');
    const link = linkOn(await page.text());
    expect(link).toMatch(/\\/magic-link\\/verify\\?token=/);
    expect(await mailbox(ios.email).all()).toEqual([]);
  });

  it('is kept whatever case the app sends the address in', async ({
    browser,
    services,
    mailbox,
  }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));

    const asked = await browser.auth.signIn.magicLink({
      email: android.email.toUpperCase(),
    });
    expect(asked.error).toBeNull();

    const page = await visit(browser, '/android');
    expect(linkOn(await page.text())).toBeDefined();
    expect(await mailbox(android.email).all()).toEqual([]);
  });

  it('signs the reviewer in as their account', async ({
    browser,
    services,
  }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));
    await browser.auth.signIn.magicLink({ email: ios.email });
    const link = linkOn(await (await visit(browser, '/ios')).text())!;

    await browser.visit(link);

    const { data } = await browser.auth.getSession();
    expect(data?.user).toMatchObject({ email: ios.email, emailVerified: true });
  });

  it('is the newest one asked for', async ({ browser, services }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));

    await browser.auth.signIn.magicLink({ email: ios.email });
    const first = linkOn(await (await visit(browser, '/ios')).text());
    await browser.auth.signIn.magicLink({ email: ios.email });
    const second = linkOn(await (await visit(browser, '/ios')).text());

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('is not shown once it has expired', async ({ browser, services }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));
    await browser.auth.signIn.magicLink({ email: ios.email });
    expect(linkOn(await (await visit(browser, '/ios')).text())).toBeDefined();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (MAGIC_LINK_MINUTES * 60 + 1) * 1000);

    const html = await (await visit(browser, '/ios')).text();
    expect(linkOn(html)).toBeUndefined();
    expect(html).toContain('No sign-in link yet');
  });

  it('is only the reviewer’s: anyone else is still emailed', async ({
    browser,
    services,
    faker,
    mailbox,
  }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));
    const email = faker.internet.email();

    await browser.auth.signIn.magicLink({ email });

    expect((await mailbox(email).last()).link).toBeDefined();
    for (const { platform } of REVIEWERS) {
      const html = await (await visit(browser, \`/\${platform}\`)).text();
      expect(linkOn(html)).toBeUndefined();
    }
  });
});

describe('GET /:platform', () => {
  it('asks for the password before showing anything', async ({ browser }) => {
    await browser.auth.signIn.magicLink({ email: ios.email });

    const response = await visit(browser, '/ios');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('name="password"');
    expect(linkOn(html)).toBeUndefined();
    expect(html).not.toContain('magic-link/verify');
  });

  it('tells a signed-in reviewer how to get a link when there is none', async ({
    browser,
    services,
  }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));

    const html = await (await visit(browser, '/android')).text();

    expect(html).toContain('No sign-in link yet');
    expect(html).toContain(android.email);
  });

  it('is never cached, indexed or framed', async ({ browser, services }) => {
    await signInToSite(browser, await services.get('reviewerPassword'));
    await browser.auth.signIn.magicLink({ email: ios.email });

    const response = await visit(browser, '/ios');

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain(
      '<meta name="robots" content="noindex, nofollow">',
    );
  });

  it('sends an unknown platform back to the choice', async ({ browser }) => {
    for (const path of ['/windows', '/IOS', '/ios%2F..']) {
      const response = await visit(browser, path);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
    }
  });
});

describe('GET /', () => {
  it('offers iOS and Android', async ({ browser }) => {
    const response = await visit(browser, '/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('href="/ios"');
    expect(html).toContain('href="/android"');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
`;
}
