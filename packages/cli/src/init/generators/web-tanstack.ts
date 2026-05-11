import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * Generate TanStack Start web app files for the fullstack template.
 *
 * Mirrors the Next.js scaffold (apps/web) but on Vite + TanStack Start +
 * TanStack Router with the `VITE_` env-var convention.
 */
export function generateTanStackWebFiles(
	options: TemplateOptions,
): GeneratedFile[] {
	if (!options.monorepo || options.template !== 'fullstack') {
		return [];
	}

	const packageName = `@${options.name}/web`;
	const apiPackage = `@${options.name}/api`;
	const modelsPackage = `@${options.name}/models`;
	const uiPackage = `@${options.name}/ui`;

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
			[apiPackage]: 'workspace:*',
			[modelsPackage]: 'workspace:*',
			[uiPackage]: 'workspace:*',
			'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@tanstack/react-query': '~5.80.0',
			'@tanstack/react-router': '^1.87.0',
			'@tanstack/react-start': '^1.87.0',
			'better-auth': '~1.2.0',
			react: '~19.2.0',
			'react-dom': '~19.2.0',
		},
		devDependencies: {
			'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
			'@tailwindcss/vite': '^4.0.0',
			'@tanstack/router-plugin': '^1.87.0',
			'@types/node': '~22.0.0',
			'@types/react': '~19.0.0',
			'@types/react-dom': '~19.0.0',
			'@vitejs/plugin-react': '^4.3.4',
			tailwindcss: '^4.0.0',
			tsx: '~4.20.0',
			typescript: '~5.8.2',
			vite: '^7.0.0',
			'vite-tsconfig-paths': '~5.1.0',
		},
	};

	const viteConfig = `import { Credentials } from '@geekmidas/envkit/credentials';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  server: {
    port: Number(Credentials.PORT ?? 3001),
  },
  // VITE_* vars are inlined automatically; no manual loadEnv needed.
  envPrefix: 'VITE_',
  plugins: [
    tsconfigPaths({ root: import.meta.dirname }),
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
			baseUrl: '.',
			types: ['vite/client'],
			paths: {
				'~/*': ['./src/*', '../../packages/ui/src/*'],
				[modelsPackage]: ['../../packages/models/src'],
				[`${modelsPackage}/*`]: ['../../packages/models/src/*'],
				[uiPackage]: ['../../packages/ui/src'],
				[`${uiPackage}/*`]: ['../../packages/ui/src/*'],
				[`${apiPackage}/client`]: ['../../apps/api/.gkm/openapi.ts'],
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

	const authClientTs = `import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { clientConfig } from '~/config/client.ts';

export const authClient = createAuthClient({
  baseURL: clientConfig.authUrl,
  plugins: [magicLinkClient()],
});

export const { signIn, signUp, signOut, useSession, magicLink } = authClient;
`;

	const apiIndexTs = `import { createApi } from '${apiPackage}/client';
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

	// Placeholder routeTree.gen — TanStack's plugin regenerates this on dev.
	const routeTreeGen = `// This file is auto-generated by @tanstack/router-plugin.
// It will be overwritten on the next \`vite dev\` run.
import { rootRouteWithContext } from '@tanstack/react-router';

export const routeTree = rootRouteWithContext()({
  // Routes are populated by the plugin from src/routes/**.tsx
} as never);
`;

	const rootRouteTsx = `/// <reference types="vite/client" />
import '~/styles/globals.css';

import { QueryClientProvider } from '@tanstack/react-query';
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { getQueryClient } from '~/lib/query-client.ts';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '${options.name}' },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const queryClient = getQueryClient();
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
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

	const indexRouteTsx = `import { createFileRoute } from '@tanstack/react-router';
import { api } from '~/api/index.ts';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

function HomeComponent() {
  const { data: health } = api.useQuery('GET /health', {});

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            Welcome to ${options.name}
          </h1>
          <p className="text-muted-foreground">
            Your TanStack Start app is ready.
          </p>
        </div>

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
`;

	const globalsCss = `@import '${uiPackage}/styles';

@source "../..";
@source "../../../../packages/ui/src";
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
			path: 'apps/web/package.json',
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{ path: 'apps/web/vite.config.ts', content: viteConfig },
		{
			path: 'apps/web/tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{ path: 'apps/web/src/lib/query-client.ts', content: queryClientTs },
		{ path: 'apps/web/src/lib/auth-client.ts', content: authClientTs },
		{ path: 'apps/web/src/config/client.ts', content: clientConfigTs },
		{ path: 'apps/web/src/config/server.ts', content: serverConfigTs },
		{ path: 'apps/web/src/api/index.ts', content: apiIndexTs },
		{ path: 'apps/web/src/router.tsx', content: routerTs },
		{ path: 'apps/web/src/routeTree.gen.ts', content: routeTreeGen },
		{ path: 'apps/web/src/routes/__root.tsx', content: rootRouteTsx },
		{ path: 'apps/web/src/routes/index.tsx', content: indexRouteTsx },
		{ path: 'apps/web/src/styles/globals.css', content: globalsCss },
		{ path: 'apps/web/.gitignore', content: gitignore },
	];
}
