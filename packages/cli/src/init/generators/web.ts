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
 * as a Next.js app.
 */
export function nextSiteFiles(
	options: TemplateOptions,
	app: SiteApp,
): GeneratedFile[] {
	const packageName = `@${options.name}/${app.key}`;
	const modelsPackage = `@${options.name}/models`;
	const authPackage = `@${options.name}/auth`;

	// package.json for web app
	const packageJson = {
		name: packageName,
		version: '0.0.1',
		private: true,
		type: 'module',
		scripts: {
			dev: 'gkm exec -- next dev --turbopack',
			build: 'gkm exec -- next build',
			start: 'next start',
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			[modelsPackage]: 'workspace:*',
			[authPackage]: 'workspace:*',
			...SHADCN_DEPENDENCIES,
			'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@tanstack/react-query': DEPENDENCY_VERSIONS['@tanstack/react-query'],
			'better-auth': DEPENDENCY_VERSIONS['better-auth'],
			next: DEPENDENCY_VERSIONS['next'],
			react: workspaceReact(options),
			'react-dom': workspaceReactDom(options),
		},
		devDependencies: {
			'@geekmidas/cli': GEEKMIDAS_VERSIONS['@geekmidas/cli'],
			'@tailwindcss/postcss': DEPENDENCY_VERSIONS['@tailwindcss/postcss'],
			'@types/node': DEPENDENCY_VERSIONS['@types/node'],
			'@types/react': workspaceReactTypes(options),
			'@types/react-dom': DEPENDENCY_VERSIONS['@types/react-dom'],
			tailwindcss: DEPENDENCY_VERSIONS['tailwindcss'],
			tsx: TOOLCHAIN_VERSIONS['tsx'],
			typescript: TOOLCHAIN_VERSIONS['typescript'],
		},
	};

	// next.config.ts
	const nextConfig = `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Workspace packages ship TypeScript, not a build.
  transpilePackages: ['${modelsPackage}', '${authPackage}'],
};

export default nextConfig;
`;

	// postcss.config.mjs for Tailwind v4
	const postcssConfig = `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;

	// tsconfig.json for Next.js
	// Note: Next.js handles compilation, so noEmit: true
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
			plugins: [
				{
					name: 'next',
				},
			],
			paths: {
				'~/*': ['./src/*'],
				// Every API's client, generated at the workspace root.
				[`@${options.name}/client/*`]: ['../../.gkm/client/*'],
				[`${modelsPackage}`]: ['../../packages/models/src'],
				[`${modelsPackage}/*`]: ['../../packages/models/src/*'],
			},
		},
		include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
		exclude: ['node_modules'],
		// No project `references`: the `paths` above already point at the
		// sources, and a reference to a project that is not `composite` makes
		// `tsc --noEmit` — the app's `typecheck` — an error.
	};

	// Query client singleton for browser, fresh instance for server
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
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: reuse existing query client
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
`;

	// Client config - NEXT_PUBLIC_* vars (available in browser)
	const clientConfigTs = `import { EnvironmentParser } from '@geekmidas/envkit';

// Client config - only NEXT_PUBLIC_* vars (available in browser)
// These values are inlined at build time by Next.js
const envParser = new EnvironmentParser({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
});

export const clientConfig = envParser
  .create((get) => ({
    apiUrl: get('NEXT_PUBLIC_API_URL').string(),
    authUrl: get('NEXT_PUBLIC_AUTH_URL').string(),
  }))
  .parse();
`;

	// Server config - server-only vars (not available in browser)
	const serverConfigTs = `import { EnvironmentParser } from '@geekmidas/envkit';

// Server config - all env vars (server-side only, not exposed to browser)
// Access these only in Server Components, Route Handlers, or Server Actions
const envParser = new EnvironmentParser({ ...process.env });

export const serverConfig = envParser
  .create((_get) => ({
    // Add server-only secrets here
    // Example: stripeSecretKey: _get('STRIPE_SECRET_KEY').string(),
  }))
  .parse();
`;

	// Providers: the shared QueryClient, and the auth client every sign-in
	// hook reads.
	const providersTsx = `'use client';

import { AuthProvider } from '${authPackage}/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { authClient } from '~/lib/auth-client.ts';
import { getQueryClient } from '~/lib/query-client.ts';

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <AuthProvider client={authClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AuthProvider>
  );
}
`;

	// API client setup - imports directly from the API package export
	const apiIndexTs = `import { createApi } from '@${options.name}/client/api';
import { getQueryClient } from '~/lib/query-client.ts';
import { clientConfig } from '~/config/client.ts';

export const api = createApi({
  baseURL: clientConfig.apiUrl,
  queryClient: getQueryClient(),
  // The session is the auth server's cookie on the shared parent domain:
  // sent to the API only when the request says to include it.
  onRequest: (config) => ({ ...config, credentials: 'include' }),
});
`;

	// App layout
	const layoutTsx = `import type { Metadata } from 'next';
import { Providers } from './providers.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: '${app.title(options)}',
  description: 'Created with gkm init',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
`;

	const pages = app.key === 'admin' ? adminPages() : webPages(options);

	// .gitignore for Next.js
	const gitignore = `.next/
next-env.d.ts
node_modules/
.env.local
*.log
`;

	return [
		{
			path: `${app.dir}/package.json`,
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{ path: `${app.dir}/next.config.ts`, content: nextConfig },
		{ path: `${app.dir}/postcss.config.mjs`, content: postcssConfig },
		{
			path: `${app.dir}/tsconfig.json`,
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{ path: `${app.dir}/src/app/globals.css`, content: SHADCN_GLOBALS_CSS },
		...shadcnFiles(app.dir, 'src/app/globals.css', { rsc: true }),
		{ path: `${app.dir}/src/app/layout.tsx`, content: layoutTsx },
		{ path: `${app.dir}/src/app/providers.tsx`, content: providersTsx },
		...pages.map(({ path, content }) => ({
			path: `${app.dir}/src/app/${path}`,
			content,
		})),
		...authComponentFiles(options, app, true),
		{ path: `${app.dir}/src/config/client.ts`, content: clientConfigTs },
		{ path: `${app.dir}/src/config/server.ts`, content: serverConfigTs },
		{ path: `${app.dir}/src/lib/query-client.ts`, content: queryClientTs },
		{
			path: `${app.dir}/src/lib/auth-client.ts`,
			content: authClientSource('~/config/client.ts'),
		},
		{ path: `${app.dir}/src/api/index.ts`, content: apiIndexTs },
		{ path: `${app.dir}/.gitignore`, content: gitignore },
	];
}

/** `/login` and `/signing-in`, the same on both sites. */
const signInPages: GeneratedFile[] = [
	{
		path: 'login/page.tsx',
		content: `import { LoginForm } from '~/auth/login-form.tsx';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <LoginForm />
    </main>
  );
}
`,
	},
	{
		path: 'signing-in/page.tsx',
		content: `'use client';

import { useRouter } from 'next/navigation';
import { SigningIn } from '~/auth/signing-in.tsx';

export default function SigningInPage() {
  const router = useRouter();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <SigningIn onSignedIn={() => router.replace('/')} />
    </main>
  );
}
`,
	},
];

/** The web site's pages: its home, and signing in. */
function webPages(options: TemplateOptions): GeneratedFile[] {
	return [
		{
			path: 'page.tsx',
			content: `import { api } from '~/api/index.ts';
import { Account } from '~/auth/account.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card.tsx';

export default async function Home() {
  // Type-safe API call using the generated client
  const health = await api('GET /health').catch(() => null);

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">Welcome to ${options.name}</h1>
            <p className="text-muted-foreground">Your fullstack application is ready.</p>
          </div>
          <Account />
        </header>

        <Card>
          <CardHeader>
            <CardTitle>API Status</CardTitle>
            <CardDescription>Connection to your backend API</CardDescription>
          </CardHeader>
          <CardContent>
            {health ? (
              <pre className="rounded-lg bg-muted p-4 text-sm">
                {JSON.stringify(health, null, 2)}
              </pre>
            ) : (
              <p className="text-destructive">Unable to connect to API</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
`,
		},
		...signInPages,
	];
}

/** The admin panel's pages: everything behind the staff gate, and signing in. */
function adminPages(): GeneratedFile[] {
	return [
		{
			path: 'page.tsx',
			content: `'use client';

import { useRouter } from 'next/navigation';
import { Dashboard } from '~/admin/dashboard.tsx';
import { StaffGate } from '~/auth/staff-gate.tsx';

export default function AdminHome() {
  const router = useRouter();
  const toLogin = () => router.replace('/login');

  return (
    <StaffGate toLogin={toLogin}>
      <Dashboard onSignedOut={toLogin} />
    </StaffGate>
  );
}
`,
		},
		...signInPages,
	];
}
