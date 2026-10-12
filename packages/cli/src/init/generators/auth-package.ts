import { DEPENDENCY_VERSIONS, TOOLCHAIN_VERSIONS } from '../dependencies.js';
import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { workspaceReact } from './react.js';

/**
 * `packages/auth`: signing in, written once and shared.
 *
 * Three entries, each for whoever is on that side of the link:
 *
 * - `@<name>/auth/magic-link` — what both sides must agree on: how long a
 *   link lasts, the error an expired one comes back with, how an address is
 *   checked, and the route a link lands on.
 * - `@<name>/auth/server` — the Better Auth plugins `constructs/auth.ts`
 *   builds the server from: the magic link, the per-address limit on asking
 *   for one, and (with a mobile app) the store reviewers' links.
 * - `@<name>/auth/client` — headless React: a provider that takes whichever
 *   Better Auth client the app built (the web's, the admin panel's, the
 *   phone's) and the hooks every one of them signs in with.
 *
 * No build step: every consumer compiles TypeScript already — Next through
 * `transpilePackages`, Vite and Metro natively, the auth server through gkm.
 */
export function generateAuthPackage(options: TemplateOptions): GeneratedFile[] {
	if (!options.monorepo || options.template !== 'fullstack') return [];

	const reviewers = options.mobileApp === true;
	const packageJson = {
		name: `@${options.name}/auth`,
		version: '0.0.1',
		private: true,
		type: 'module',
		exports: {
			'./server': './src/server/index.ts',
			'./client': './src/client/index.ts',
			'./*': './src/*.ts',
		},
		scripts: {
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			'better-auth': DEPENDENCY_VERSIONS['better-auth'],
			zod: DEPENDENCY_VERSIONS.zod,
		},
		peerDependencies: {
			react: workspaceReact(options),
		},
		devDependencies: {
			'@types/react': DEPENDENCY_VERSIONS['@types/react'],
			react: workspaceReact(options),
			typescript: TOOLCHAIN_VERSIONS.typescript,
		},
	};

	const tsConfig = {
		extends: '../../tsconfig.json',
		compilerOptions: {
			noEmit: true,
			allowImportingTsExtensions: true,
			jsx: 'react-jsx',
			lib: ['ES2022', 'DOM'],
		},
		include: ['src/**/*.ts', 'src/**/*.tsx'],
		exclude: ['node_modules', 'dist'],
	};

	return [
		{
			path: 'packages/auth/package.json',
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{
			path: 'packages/auth/tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{ path: 'packages/auth/src/magic-link.ts', content: magicLinkTs },
		...(reviewers
			? [
					{
						path: 'packages/auth/src/reviewers.ts',
						content: reviewersTs(options.name),
					},
				]
			: []),
		{
			path: 'packages/auth/src/server/index.ts',
			content: serverIndexTs(reviewers),
		},
		{
			path: 'packages/auth/src/server/magic-link.ts',
			content: serverMagicLinkTs(reviewers),
		},
		{
			path: 'packages/auth/src/server/email-limit.ts',
			content: serverEmailLimitTs,
		},
		...(reviewers
			? [
					{
						path: 'packages/auth/src/server/reviewer-links.ts',
						content: serverReviewerLinksTs,
					},
				]
			: []),
		{ path: 'packages/auth/src/client/index.ts', content: clientIndexTs },
		{
			path: 'packages/auth/src/client/sign-in-link.ts',
			content: clientSignInLinkTs(options.name),
		},
		{
			path: 'packages/auth/src/client/provider.tsx',
			content: clientProviderTsx,
		},
		{ path: 'packages/auth/src/client/hooks.ts', content: clientHooksTs },
	];
}

const magicLinkTs = `import { z } from 'zod';

// ============================================
// Sign-in links
// ============================================
//
// Shared by the auth server and every app, so the screen that asks for a link
// checks the address the way the server does, says how long the link lasts in
// the server's own number, and listens for the code the server actually sends.

/** Why an address is refused, in the words an app shows. */
export const INVALID_EMAIL = 'Enter an email address like name@example.com';

/**
 * An email address, as signing in takes it: the check Better Auth's magic
 * link makes (\`z.email()\`), with the words an app shows when it refuses one.
 */
export const EmailSchema = z.email(INVALID_EMAIL);

/**
 * How long a sign-in link works, in minutes. The auth server sets the link's
 * lifetime from it, the email says it, and so does every Check your email
 * screen.
 */
export const MAGIC_LINK_MINUTES = 15;

/**
 * The \`error\` a sign-in link redirects with when it cannot sign anyone in:
 * expired, already used, or never issued. Better Auth deletes a link's row
 * the first time it is opened, so nothing is left to tell the three apart —
 * and the answer is the same for all of them: send a new link.
 */
export const MAGIC_LINK_INVALID = 'INVALID_TOKEN';

/**
 * How often a link can be asked for, each a \`window\` in seconds. Per IP, so
 * one machine cannot mail every address it can guess; per email, so one inbox
 * cannot be flooded from many machines. Both answer the same 429 for an
 * address with an account as for one without.
 */
export const MAGIC_LINK_LIMITS = {
  perIp: { window: 15 * 60, max: 20 },
  perEmail: { window: 15 * 60, max: 5 },
} as const;

/**
 * Where an opened link lands in an app: \`/signing-in\`. The web site and the
 * admin panel are sent to it on their own origin; the mobile app at its scheme.
 */
export const LINK_ROUTE = '/signing-in';
`;

function reviewersTs(name: string): string {
	return `// ============================================
// Store reviewers
// ============================================

/**
 * The accounts App Store and Play Store reviewers sign in as.
 *
 * A reviewer has no inbox, so the sign-in link the app asks for is not mailed
 * to these addresses: the auth server keeps it in \`reviewer_links\`
 * (\`@${name}/auth/server\`), and the reviewer site (\`reviewer.<domain>\`)
 * shows it to whoever has its password. Give these to the stores in the
 * review notes, with the reviewer site's address and password.
 *
 * Change the addresses to ones on your own domain: nothing is ever sent to
 * them, but a store reviewer reads them.
 */
export const REVIEWERS = [
  {
    platform: 'ios',
    label: 'iOS',
    store: 'App Store',
    email: 'review+ios@example.com',
    name: 'iOS Reviewer',
  },
  {
    platform: 'android',
    label: 'Android',
    store: 'Google Play',
    email: 'review+android@example.com',
    name: 'Android Reviewer',
  },
] as const satisfies readonly {
  platform: string;
  label: string;
  store: string;
  email: string;
  name: string;
}[];

export type Reviewer = (typeof REVIEWERS)[number];

/** A platform the reviewer site has a page for: \`ios\`, \`android\`. */
export type ReviewerPlatform = Reviewer['platform'];

/** The reviewer \`email\` belongs to, ignoring case and spaces, if any. */
export function reviewerByEmail(email: string): Reviewer | undefined {
  const address = email.trim().toLowerCase();
  return REVIEWERS.find((reviewer) => reviewer.email === address);
}

/** The reviewer for \`platform\`, if it is one of theirs. */
export function reviewerOn(platform: string): Reviewer | undefined {
  return REVIEWERS.find((reviewer) => reviewer.platform === platform);
}
`;
}

function serverIndexTs(reviewers: boolean): string {
	return `// What the auth server is built from (\`constructs/auth.ts\`). Server-only:
// nothing here belongs in a browser or a phone.

export { magicLinkEmailLimit } from './email-limit.ts';
export { magicLinkSignIn${reviewers ? ', ReviewerLinkWithoutContext' : ''} } from './magic-link.ts';${
		reviewers
			? `
export { reviewerLinks } from './reviewer-links.ts';`
			: ''
	}
`;
}

function serverMagicLinkTs(reviewers: boolean): string {
	const imports = reviewers
		? `import { type MagicLinkOptions, magicLink } from 'better-auth/plugins';
import { MAGIC_LINK_LIMITS, MAGIC_LINK_MINUTES } from '../magic-link.ts';
import { reviewerByEmail } from '../reviewers.ts';
import { keepReviewerLink } from './reviewer-links.ts';`
		: `import { type MagicLinkOptions, magicLink } from 'better-auth/plugins';
import { MAGIC_LINK_LIMITS, MAGIC_LINK_MINUTES } from '../magic-link.ts';`;

	const send = reviewers
		? `    sendMagicLink: async (data, ctx) => {
      const reviewer = reviewerByEmail(data.email);
      if (!reviewer) return sendMagicLink(data, ctx);
      if (!ctx) throw new ReviewerLinkWithoutContext(reviewer.email);

      await keepReviewerLink(ctx.context.adapter, {
        email: reviewer.email,
        url: data.url,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      });
    },`
		: '    sendMagicLink,';

	const reviewerDoc = reviewers
		? `
 *
 * A link for a store reviewer's address (\`REVIEWERS\`) is never sent: the
 * reviewer has no inbox. It is kept in \`reviewer_links\` instead, where the
 * reviewer site shows it. Every other address is handed to \`sendMagicLink\`.`
		: '';

	const error = reviewers
		? `

/**
 * Better Auth asked for a reviewer's link to be sent without the request it
 * came from, so there is no database to keep it in.
 */
export class ReviewerLinkWithoutContext extends Error {
  constructor(readonly email: string) {
    super(
      \`The sign-in link for \${email} came without its request context, so it \` +
        'could not be kept in reviewer_links. Better Auth passes it to ' +
        'sendMagicLink on every sign-in request; check the magic-link plugin ' +
        'has not been called from somewhere else.',
    );
    this.name = 'ReviewerLinkWithoutContext';
  }
}`
		: '';

	return `${imports}

/**
 * Better Auth's magic link, as this product signs in with it.
 *
 * A function, so a test can build it with a lifetime short enough to wait
 * out; the server takes the defaults. A new address gets an account when its
 * link is opened, so signing in and signing up are one flow.${reviewerDoc}
 */
export const magicLinkSignIn = ({
  sendMagicLink,
  expiresIn = MAGIC_LINK_MINUTES * 60,
}: {
  sendMagicLink: MagicLinkOptions['sendMagicLink'];
  /** In seconds. */
  expiresIn?: number;
}) =>
  magicLink({
    expiresIn,
    // Better Auth's own limiter, keyed by IP and path: asking for a link and
    // opening one are counted apart.
    rateLimit: MAGIC_LINK_LIMITS.perIp,
${send}
  });${error}
`;
}

const serverEmailLimitTs = `import type { BetterAuthPlugin, DBAdapter } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';

/**
 * The per-address limit on asking for a sign-in link.
 *
 * Better Auth's limiter keys only by IP and path, so this counts the address
 * in the same \`rateLimit\` table, under its own key, before the link is made
 * or sent. Needs \`rateLimit: { enabled: true, storage: 'database' }\`.
 */
export const magicLinkEmailLimit = ({
  window,
  max,
}: {
  window: number;
  max: number;
}): BetterAuthPlugin => ({
  id: 'magic-link-email-limit',
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === '/sign-in/magic-link',
        handler: createAuthMiddleware(async (ctx) => {
          if (!ctx.context.rateLimit.enabled) return;
          const address: unknown = ctx.body?.email;
          // Not an address: the endpoint's own schema refuses it.
          if (typeof address !== 'string') return;

          const retryAfter = await consume(
            ctx.context.adapter,
            \`magic-link-email|\${address.trim().toLowerCase()}\`,
            { window, max },
          );
          if (retryAfter !== null) {
            throw new APIError(
              'TOO_MANY_REQUESTS',
              { message: 'Too many requests. Please try again later.' },
              { 'X-Retry-After': String(retryAfter) },
            );
          }
        }),
      },
    ],
  },
});

/**
 * Count one request against \`key\`: \`null\` when it is allowed, or the seconds
 * until it would be. Each step is one conditional write, so two requests at
 * once cannot both take the last place.
 */
async function consume(
  adapter: DBAdapter,
  key: string,
  rule: { window: number; max: number },
  attempt = 0,
): Promise<number | null> {
  const now = Date.now();
  const since = now - rule.window * 1000;
  const byKey = { field: 'key', value: key };

  // Inside the window and under the limit.
  const counted = await adapter.incrementOne({
    model: 'rateLimit',
    where: [
      byKey,
      { field: 'lastRequest', operator: 'gt', value: since },
      { field: 'count', operator: 'lt', value: rule.max },
    ],
    increment: { count: 1 },
    set: { lastRequest: now },
  });
  if (counted) return null;

  // The window has passed: this request starts the next one.
  const restarted = await adapter.incrementOne({
    model: 'rateLimit',
    where: [byKey, { field: 'lastRequest', operator: 'lte', value: since }],
    increment: {},
    set: { count: 1, lastRequest: now },
  });
  if (restarted) return null;

  const row = await adapter.findOne<{ lastRequest: number | string }>({
    model: 'rateLimit',
    where: [byKey],
  });
  if (row) {
    return Math.max(
      1,
      Math.ceil((Number(row.lastRequest) + rule.window * 1000 - now) / 1000),
    );
  }

  // The first request for this key.
  try {
    await adapter.create({
      model: 'rateLimit',
      data: { key, count: 1, lastRequest: now },
    });
    return null;
  } catch (error) {
    // Another request made the row first; count against it instead.
    if (attempt > 0) throw error;
    return consume(adapter, key, rule, attempt + 1);
  }
}
`;

const serverReviewerLinksTs = `import type { BetterAuthPlugin, DBAdapter } from 'better-auth';

/** The model \`reviewerLinks()\` declares, as the adapter names it. */
const REVIEWER_LINK_MODEL = 'reviewerLink';

/**
 * \`reviewer_links\`: the latest sign-in link for each store reviewer's
 * address, until it expires. Declared to Better Auth, so its adapter writes it
 * (in a test's transaction, in a test) and \`gkm migration auth\` creates it.
 * The reviewer site reads it.
 */
export const reviewerLinks = (): BetterAuthPlugin => ({
  id: 'reviewer-links',
  schema: {
    [REVIEWER_LINK_MODEL]: {
      modelName: 'reviewer_links',
      fields: {
        email: { type: 'string', required: true, unique: true },
        url: { type: 'string', required: true },
        expiresAt: { type: 'date', required: true, fieldName: 'expires_at' },
        createdAt: { type: 'date', required: true, fieldName: 'created_at' },
      },
    },
  },
});

/**
 * Keep \`link\` as \`email\`'s, replacing the one before: a reviewer is shown
 * the link they asked for last, and an earlier one is useless anyway once they
 * have asked again.
 */
export async function keepReviewerLink(
  adapter: DBAdapter,
  link: { email: string; url: string; expiresAt: Date },
  attempt = 0,
): Promise<void> {
  const values = { ...link, createdAt: new Date() };
  const replaced = await adapter.update({
    model: REVIEWER_LINK_MODEL,
    where: [{ field: 'email', value: link.email }],
    update: values,
  });
  if (replaced) return;

  try {
    await adapter.create({ model: REVIEWER_LINK_MODEL, data: values });
  } catch (error) {
    // Another request made the row first; replace it instead.
    if (attempt > 0) throw error;
    await keepReviewerLink(adapter, link, attempt + 1);
  }
}
`;

const clientIndexTs = `// Signing in from any app — the web site, the admin panel, the phone.
// Headless: hooks and a provider, no screens. Each app draws its own, and
// passes in the Better Auth client it built for where it runs.

export {
  type AuthClient,
  AuthProvider,
  useAuthClient,
} from './provider.tsx';
export {
  useRequestSignInLink,
  useSession,
  useSignInLinkResult,
  useSignOut,
} from './hooks.ts';
export {
  expiredLinkRoute,
  type Landing,
  type LinkParams,
  type LinkRequest,
  landing,
  linkParams,
  NOT_SENT,
  OFFLINE,
  requestSignInLink,
  type SignInLinkClient,
  tooManyRequests,
} from './sign-in-link.ts';
`;

function clientSignInLinkTs(name: string): string {
	return `import { INVALID_EMAIL, MAGIC_LINK_INVALID } from '../magic-link.ts';

// Asking for a sign-in link, and reading where opening it landed. Plain
// functions — the hooks are a thin layer over these, and a test can run them
// against the real auth server.

/**
 * The part of a Better Auth client asking for a link takes: any client built
 * with \`magicLinkClient()\`.
 */
export interface SignInLinkClient {
  signIn: {
    magicLink(body: {
      email: string;
      callbackURL: string;
      errorCallbackURL?: string;
      fetchOptions?: { onError?: (context: { response: Response }) => void };
    }): Promise<{ error: { status: number; message?: string } | null }>;
  };
}

export type LinkRequest = { sent: true } | { sent: false; message: string };

export const OFFLINE =
  "We couldn't reach ${name}. Check your connection and try again.";
export const NOT_SENT = "We couldn't send your link. Try again in a moment.";

/** \`Try again in 15 minutes.\`, from the server's \`X-Retry-After\` seconds. */
export function tooManyRequests(retryAfter: number | undefined): string {
  const minutes = retryAfter ? Math.ceil(retryAfter / 60) : undefined;
  const wait =
    minutes === undefined
      ? 'a few minutes'
      : minutes === 1
        ? 'a minute'
        : \`\${minutes} minutes\`;
  return \`You've asked for a few links already. Try again in \${wait}.\`;
}

/**
 * Where a link that no longer works lands: \`callbackURL\` again, with the
 * address it was sent to (\`?to=\`), so the screen can send a new one there.
 * The auth server adds \`?error=\` to it.
 *
 * The address goes as base64url, not percent-encoded: on its way back the URL
 * is encoded and decoded more often than the other way round, so a \`+\` in an
 * address came back as a space. base64url has nothing any of them change.
 */
export function expiredLinkRoute(callbackURL: string, email: string): string {
  const separator = callbackURL.includes('?') ? '&' : '?';
  return \`\${callbackURL}\${separator}to=\${encodeAddress(email)}\`;
}

const encodeAddress = (email: string) =>
  btoa(encodeURIComponent(email))
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
    .replace(/=+$/, '');

/** The address \`encodeAddress\` wrote, or none if \`to\` is not one. */
const decodeAddress = (to: string): string | undefined => {
  try {
    const email = decodeURIComponent(
      atob(to.replace(/-/g, '+').replace(/_/g, '/')),
    );
    return email.includes('@') ? email : undefined;
  } catch {
    // Not base64url, or not an address: a link edited by hand. The screen
    // asks for the address again instead.
    return undefined;
  }
};

/**
 * Ask the auth server to email \`email\` a sign-in link, and say why not when
 * it refuses: too many asked for, an address it does not take, or no answer.
 * Whether the address has an account is never part of the answer.
 */
export async function requestSignInLink(
  client: SignInLinkClient,
  email: string,
  {
    callbackURL,
    errorCallbackURL = expiredLinkRoute(callbackURL, email),
  }: { callbackURL: string; errorCallbackURL?: string },
): Promise<LinkRequest> {
  let retryAfter: number | undefined;
  try {
    const { error } = await client.signIn.magicLink({
      email,
      callbackURL,
      errorCallbackURL,
      fetchOptions: {
        onError: ({ response }) => {
          const seconds = Number(response.headers.get('X-Retry-After'));
          if (seconds > 0) retryAfter = seconds;
        },
      },
    });
    if (!error) return { sent: true };
    if (error.status === 429) {
      return { sent: false, message: tooManyRequests(retryAfter) };
    }
    if (error.status === 400 || error.status === 422) {
      return { sent: false, message: INVALID_EMAIL };
    }
    if (!error.status) return { sent: false, message: OFFLINE };
    return { sent: false, message: NOT_SENT };
  } catch {
    return { sent: false, message: OFFLINE };
  }
}

/** The query a link lands on \`LINK_ROUTE\` with. */
export interface LinkParams {
  /** The session, on a phone: the Expo plugin carries it on the redirect. */
  cookie?: string;
  error?: string;
  /** The address the link was sent to, as \`expiredLinkRoute\` wrote it. */
  to?: string;
}

/**
 * The query of the link that was opened, decoded once. \`link\` is the URL or
 * path as it arrived (\`https://…/signing-in?…\`, \`<scheme>://signing-in?…\`).
 *
 * Read from the link itself, not a router's params: a router decodes a query
 * as a form does, \`+\` to a space, and a session cookie's signature is base64.
 */
export function linkParams(link: string): LinkParams {
  const start = link.indexOf('?');
  const query = new URLSearchParams(start === -1 ? '' : link.slice(start + 1));
  return {
    ...(query.get('cookie') ? { cookie: query.get('cookie') as string } : {}),
    ...(query.get('error') ? { error: query.get('error') as string } : {}),
    ...(query.get('to') ? { to: query.get('to') as string } : {}),
  };
}

export type Landing =
  /**
   * Signed in. On a phone, \`cookie\` is the session to keep; on the web the
   * auth server already set it, and there is none.
   */
  | { signedIn: true; cookie?: string }
  /** Used, expired or never issued: a new link is the answer. */
  | { signedIn: false; reason: 'expired'; email?: string }
  | { signedIn: false; reason: 'failed' };

/** What opening a link did: signed in, or why not. */
export function landing(params: LinkParams): Landing {
  if (params.error === MAGIC_LINK_INVALID) {
    const email = params.to ? decodeAddress(params.to) : undefined;
    return email
      ? { signedIn: false, reason: 'expired', email }
      : { signedIn: false, reason: 'expired' };
  }
  if (params.error) return { signedIn: false, reason: 'failed' };
  return params.cookie
    ? { signedIn: true, cookie: params.cookie }
    : { signedIn: true };
}
`;
}

const clientProviderTsx = `import { createContext, type ReactNode, useContext } from 'react';
import type { SignInLinkClient } from './sign-in-link.ts';

/**
 * The Better Auth client an app built for where it runs — the web's with
 * \`magicLinkClient()\`, the phone's with \`expoClient()\` too. Only the part
 * the hooks use, so any of them fits.
 */
export interface AuthClient extends SignInLinkClient {
  useSession: () => {
    data: { user: { id: string; email: string; name: string } } | null;
    isPending: boolean;
    error: unknown;
    refetch: () => void;
  };
  signOut: () => Promise<unknown>;
}

const AuthContext = createContext<AuthClient | null>(null);

/**
 * Hands every hook below it the app's auth client. Wrap the app in it once,
 * at its root.
 */
export function AuthProvider({
  client,
  children,
}: {
  client: AuthClient;
  children: ReactNode;
}) {
  return <AuthContext.Provider value={client}>{children}</AuthContext.Provider>;
}

/** The client \`AuthProvider\` was given. */
export function useAuthClient(): AuthClient {
  const client = useContext(AuthContext);
  if (!client) throw new AuthProviderMissing();
  return client;
}

/** A hook from \`@<name>/auth/client\` was used outside \`AuthProvider\`. */
export class AuthProviderMissing extends Error {
  constructor() {
    super(
      'An auth hook ran outside <AuthProvider>. Wrap the app once at its root: ' +
        '<AuthProvider client={authClient}>…</AuthProvider>.',
    );
    this.name = 'AuthProviderMissing';
  }
}
`;

const clientHooksTs = `import { useCallback, useMemo, useState } from 'react';
import { useAuthClient } from './provider.tsx';
import {
  type Landing,
  type LinkRequest,
  landing,
  linkParams,
  requestSignInLink,
} from './sign-in-link.ts';

/** Who is signed in: the client's own session hook. */
export function useSession() {
  return useAuthClient().useSession();
}

/**
 * Ask for a sign-in link: \`request(email)\` sends it and resolves with what
 * happened, which \`result\` also holds until \`reset()\`.
 *
 * \`callbackURL\` is where an opened link lands — \`\${origin}/signing-in\` on
 * the web, \`LINK_ROUTE\` on a phone. A link that no longer works lands there
 * too, with the address, unless \`errorCallbackURL\` says otherwise.
 */
export function useRequestSignInLink({
  callbackURL,
  errorCallbackURL,
}: {
  callbackURL: string;
  errorCallbackURL?: string;
}) {
  const client = useAuthClient();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<LinkRequest>();

  const request = useCallback(
    async (email: string) => {
      setPending(true);
      try {
        const sent = await requestSignInLink(client, email, {
          callbackURL,
          ...(errorCallbackURL ? { errorCallbackURL } : {}),
        });
        setResult(sent);
        return sent;
      } finally {
        setPending(false);
      }
    },
    [client, callbackURL, errorCallbackURL],
  );

  const reset = useCallback(() => setResult(undefined), []);

  return { request, pending, result, reset };
}

/** Where opening the link \`link\` landed: signed in, expired, or failed. */
export function useSignInLinkResult(link: string): Landing {
  return useMemo(() => landing(linkParams(link)), [link]);
}

/** Sign out on the auth server. */
export function useSignOut() {
  const client = useAuthClient();
  const [pending, setPending] = useState(false);

  const signOut = useCallback(async () => {
    setPending(true);
    try {
      await client.signOut();
    } finally {
      setPending(false);
    }
  }, [client]);

  return { signOut, pending };
}
`;
