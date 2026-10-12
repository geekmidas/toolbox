import { DEPENDENCY_VERSIONS, TOOLCHAIN_VERSIONS } from '../dependencies.js';
import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';
import {
	workspaceReact,
	workspaceReactDom,
	workspaceReactTypes,
} from './react.js';
import {
	SHADCN_DEPENDENCIES,
	SHADCN_GLOBALS_CSS,
	shadcnFiles,
} from './shadcn.js';
import {
	authClientSource,
	authComponentFiles,
	type SiteApp,
} from './site-auth.js';

/**
 * One of the fullstack template's sites — the web site or the admin panel —
 * on Vite + TanStack Start + TanStack Router, with the `VITE_` env-var
 * convention.
 */
export function tanstackSiteFiles(
	options: TemplateOptions,
	app: SiteApp,
): GeneratedFile[] {
	const packageName = `@${options.name}/${app.key}`;
	const modelsPackage = `@${options.name}/models`;
	const authPackage = `@${options.name}/auth`;

	const packageJson = {
		name: packageName,
		version: '0.0.1',
		private: true,
		type: 'module',
		scripts: {
			dev: 'gkm exec -- vite dev',
			build: 'gkm exec -- vite build',
			start: 'node .output/server/index.mjs',
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			[modelsPackage]: 'workspace:*',
			[authPackage]: 'workspace:*',
			...SHADCN_DEPENDENCIES,
			'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@tanstack/react-query': DEPENDENCY_VERSIONS['@tanstack/react-query'],
			'@tanstack/react-router': DEPENDENCY_VERSIONS['@tanstack/react-router'],
			'@tanstack/react-start': DEPENDENCY_VERSIONS['@tanstack/react-start'],
			'better-auth': DEPENDENCY_VERSIONS['better-auth'],
			react: workspaceReact(options),
			'react-dom': workspaceReactDom(options),
		},
		devDependencies: {
			'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
			'@tailwindcss/vite': DEPENDENCY_VERSIONS['@tailwindcss/vite'],
			'@tanstack/router-plugin': DEPENDENCY_VERSIONS['@tanstack/router-plugin'],
			'@types/node': DEPENDENCY_VERSIONS['@types/node'],
			'@types/react': workspaceReactTypes(options),
			'@types/react-dom': DEPENDENCY_VERSIONS['@types/react-dom'],
			'@vitejs/plugin-react': TOOLCHAIN_VERSIONS['@vitejs/plugin-react'],
			tailwindcss: DEPENDENCY_VERSIONS['tailwindcss'],
			tsx: TOOLCHAIN_VERSIONS['tsx'],
			typescript: TOOLCHAIN_VERSIONS['typescript'],
			vite: TOOLCHAIN_VERSIONS['vite'],
		},
	};

	const viteConfig = `import { Credentials } from '@geekmidas/envkit/credentials';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Vite resolves tsconfig \`paths\` itself; no plugin needed.
  resolve: { tsconfigPaths: true },
  server: {
    port: Number(Credentials.PORT ?? 3001),
  },
  // VITE_* vars are inlined automatically; no manual loadEnv needed.
  envPrefix: 'VITE_',
  plugins: [
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
`;

	const tsConfig = {
		extends: '../../tsconfig.json',
		compilerOptions: {
			lib: ['dom', 'dom.iterable', 'ES2022'],
			allowJs: true,
			skipLibCheck: true,
			strict: true,
			noEmit: true,
			allowImportingTsExtensions: true,
			esModuleInterop: true,
			module: 'ESNext',
			moduleResolution: 'bundler',
			resolveJsonModule: true,
			isolatedModules: true,
			jsx: 'preserve',
			incremental: true,
			types: ['vite/client'],
			paths: {
				'~/*': ['./src/*'],
				[modelsPackage]: ['../../packages/models/src'],
				[`${modelsPackage}/*`]: ['../../packages/models/src/*'],
				// Every API's client, generated at the workspace root.
				[`@${options.name}/client/*`]: ['../../.gkm/client/*'],
			},
		},
		include: ['**/*.ts', '**/*.tsx', 'src/routeTree.gen.ts'],
		exclude: ['node_modules', '.output', '.vinxi', 'dist'],
	};

	const queryClientTs = `import { QueryClient } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient() {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
`;

	const clientConfigTs = `import { EnvironmentParser } from '@geekmidas/envkit';

// Client config - VITE_* vars are inlined at build time.
const envParser = new EnvironmentParser({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_AUTH_URL: import.meta.env.VITE_AUTH_URL,
});

export const clientConfig = envParser
  .create((get) => ({
    apiUrl: get('VITE_API_URL').string(),
    authUrl: get('VITE_AUTH_URL').string(),
  }))
  .parse();
`;

	const serverConfigTs = `import { EnvironmentParser } from '@geekmidas/envkit';

// Server config - all env vars (server-side only, not exposed to browser).
// Access these only in TanStack Start server functions / server routes.
const envParser = new EnvironmentParser({ ...process.env });

export const serverConfig = envParser
  .create((_get) => ({
    // Add server-only secrets here
    // Example: stripeSecretKey: _get('STRIPE_SECRET_KEY').string(),
  }))
  .parse();
`;

	const apiIndexTs = `import { createApi } from '@${options.name}/client/api';
import { clientConfig } from '~/config/client.ts';
import { getQueryClient } from '~/lib/query-client.ts';

export function createAppApi(options?: { headers?: Record<string, string> }) {
  return createApi({
    baseURL: clientConfig.apiUrl,
    queryClient: getQueryClient(),
    headers: options?.headers,
    onRequest: (config) => ({ ...config, credentials: 'include' }),
  });
}

export const api = createAppApi();
`;

	const routerTs = `import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen.ts';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
`;

	// The route tree TanStack's plugin writes for the routes below, as it writes
	// it: the plugin overwrites it on every `vite dev` and `vite build`, but
	// a fresh checkout typechecks before either has run — and against a stub,
	// every \`createFileRoute('/login')\` is an error.
	const routeTreeGen = `/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file was automatically generated by TanStack Router.
// You should NOT make any changes in this file as it will be overwritten.
// Additionally, you should also exclude this file from your linter and/or formatter to prevent it from being checked or modified.

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as LoginRouteImport } from './routes/login'
import { Route as SigningInRouteImport } from './routes/signing-in'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)
const LoginRoute = LoginRouteImport.update({
  id: '/login',
  path: '/login',
  getParentRoute: () => rootRouteImport,
} as any)
const SigningInRoute = SigningInRouteImport.update({
  id: '/signing-in',
  path: '/signing-in',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/login': typeof LoginRoute
  '/signing-in': typeof SigningInRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/login': typeof LoginRoute
  '/signing-in': typeof SigningInRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/login': typeof LoginRoute
  '/signing-in': typeof SigningInRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/login' | '/signing-in'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/login' | '/signing-in'
  id: '__root__' | '/' | '/login' | '/signing-in'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  LoginRoute: typeof LoginRoute
  SigningInRoute: typeof SigningInRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/login': {
      id: '/login'
      path: '/login'
      fullPath: '/login'
      preLoaderRoute: typeof LoginRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/signing-in': {
      id: '/signing-in'
      path: '/signing-in'
      fullPath: '/signing-in'
      preLoaderRoute: typeof SigningInRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  LoginRoute: LoginRoute,
  SigningInRoute: SigningInRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
`;

	const rootRouteTsx = `/// <reference types="vite/client" />
import '~/styles/globals.css';

import { AuthProvider } from '${authPackage}/client';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { authClient } from '~/lib/auth-client.ts';
import { getQueryClient } from '~/lib/query-client.ts';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '${app.title(options)}' },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const queryClient = getQueryClient();
  return (
    <RootDocument>
      <AuthProvider client={authClient}>
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
      </AuthProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
`;

	const routes = app.key === 'admin' ? adminRoutes() : webRoutes(options);

	const globalsCss = `${SHADCN_GLOBALS_CSS}
@source "../..";
`;

	const gitignore = `.output/
.vinxi/
node_modules/
.env.local
*.log
src/routeTree.gen.ts
`;

	return [
		{
			path: `${app.dir}/package.json`,
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{ path: `${app.dir}/vite.config.ts`, content: viteConfig },
		{
			path: `${app.dir}/tsconfig.json`,
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{ path: `${app.dir}/src/lib/query-client.ts`, content: queryClientTs },
		{
			path: `${app.dir}/src/lib/auth-client.ts`,
			content: authClientSource('~/config/client.ts'),
		},
		{ path: `${app.dir}/src/config/client.ts`, content: clientConfigTs },
		{ path: `${app.dir}/src/config/server.ts`, content: serverConfigTs },
		{ path: `${app.dir}/src/api/index.ts`, content: apiIndexTs },
		{ path: `${app.dir}/src/router.tsx`, content: routerTs },
		{ path: `${app.dir}/src/routeTree.gen.ts`, content: routeTreeGen },
		{ path: `${app.dir}/src/routes/__root.tsx`, content: rootRouteTsx },
		...routes.map(({ path, content }) => ({
			path: `${app.dir}/src/routes/${path}`,
			content,
		})),
		...authComponentFiles(options, app, false),
		{ path: `${app.dir}/src/styles/globals.css`, content: globalsCss },
		...shadcnFiles(app.dir, 'src/styles/globals.css', { rsc: false }),
		{ path: `${app.dir}/.gitignore`, content: gitignore },
	];
}

/** `/login` and `/signing-in`, the same on both sites. */
const signInRoutes: GeneratedFile[] = [
	{
		path: 'login.tsx',
		content: `import { createFileRoute } from '@tanstack/react-router';
import { LoginForm } from '~/auth/login-form.tsx';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <LoginForm />
    </main>
  );
}
`,
	},
	{
		path: 'signing-in.tsx',
		content: `import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { SigningIn } from '~/auth/signing-in.tsx';

export const Route = createFileRoute('/signing-in')({
  component: SigningInPage,
});

function SigningInPage() {
  const navigate = useNavigate();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <SigningIn onSignedIn={() => navigate({ to: '/', replace: true })} />
    </main>
  );
}
`,
	},
];

/** The web site's routes: its home, and signing in. */
function webRoutes(options: TemplateOptions): GeneratedFile[] {
	return [
		{
			path: 'index.tsx',
			content: `import { createFileRoute } from '@tanstack/react-router';
import { api } from '~/api/index.ts';
import { Account } from '~/auth/account.tsx';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

function HomeComponent() {
  const { data: health } = api.useQuery('GET /health', {});

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">
              Welcome to ${options.name}
            </h1>
            <p className="text-muted-foreground">
              Your TanStack Start app is ready.
            </p>
          </div>
          <Account />
        </header>

        <section className="rounded-lg border p-6">
          <h2 className="text-xl font-semibold">API Status</h2>
          {health ? (
            <pre className="mt-4 rounded bg-muted p-4 text-sm">
              {JSON.stringify(health, null, 2)}
            </pre>
          ) : (
            <p className="mt-2 text-muted-foreground">Connecting…</p>
          )}
        </section>
      </div>
    </main>
  );
}
`,
		},
		...signInRoutes,
	];
}

/** The admin panel's routes: everything behind the staff gate, and signing in. */
function adminRoutes(): GeneratedFile[] {
	return [
		{
			path: 'index.tsx',
			content: `import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Dashboard } from '~/admin/dashboard.tsx';
import { StaffGate } from '~/auth/staff-gate.tsx';

export const Route = createFileRoute('/')({
  component: AdminHome,
});

function AdminHome() {
  const navigate = useNavigate();
  const toLogin = () => navigate({ to: '/login', replace: true });

  return (
    <StaffGate toLogin={toLogin}>
      <Dashboard onSignedOut={toLogin} />
    </StaffGate>
  );
}
`,
		},
		...signInRoutes,
	];
}
