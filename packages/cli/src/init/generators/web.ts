import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * Generate Next.js web app files for fullstack template
 */
export function generateWebAppFiles(options: TemplateOptions): GeneratedFile[] {
	if (!options.monorepo || options.template !== 'fullstack') {
		return [];
	}

	const packageName = `@${options.name}/web`;
	const modelsPackage = `@${options.name}/models`;
	const uiPackage = `@${options.name}/ui`;

	// package.json for web app
	const packageJson = {
		name: packageName,
		version: '0.0.1',
		private: true,
		type: 'module',
		scripts: {
			dev: 'next dev -p 3001',
			build: 'next build',
			start: 'next start',
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			[modelsPackage]: 'workspace:*',
			[uiPackage]: 'workspace:*',
			'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
			'@tanstack/react-query': '~5.80.0',
			next: '~16.1.0',
			react: '~19.2.0',
			'react-dom': '~19.2.0',
		},
		devDependencies: {
			'@tailwindcss/postcss': '^4.0.0',
			'@types/node': '~22.0.0',
			'@types/react': '~19.0.0',
			'@types/react-dom': '~19.0.0',
			tailwindcss: '^4.0.0',
			typescript: '~5.8.2',
		},
	};

	// next.config.ts
	const nextConfig = `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['${modelsPackage}', '${uiPackage}'],
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
				[`${modelsPackage}`]: ['../../packages/models/src'],
				[`${modelsPackage}/*`]: ['../../packages/models/src/*'],
				[`${uiPackage}`]: ['../../packages/ui/src'],
				[`${uiPackage}/*`]: ['../../packages/ui/src/*'],
			},
			baseUrl: '.',
		},
		include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
		exclude: ['node_modules'],
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

	// Providers using shared QueryClient
	const providersTsx = `'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
`;

	// API client setup - uses createApi with shared QueryClient
	const apiIndexTs = `import { createApi } from './openapi';
import { getQueryClient } from '~/lib/query-client';

export const api = createApi({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  queryClient: getQueryClient(),
});
`;

	// globals.css that imports UI package styles
	const globalsCss = `@import '${uiPackage}/styles';
`;

	// App layout
	const layoutTsx = `import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: '${options.name}',
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

	// Home page with API example using UI components
	const pageTsx = `import { api } from '~/api';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '${uiPackage}/components';

export default async function Home() {
  // Type-safe API call using the generated client
  const health = await api('GET /health').catch(() => null);

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Welcome to ${options.name}</h1>
          <p className="text-muted-foreground">Your fullstack application is ready.</p>
        </div>

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

        <Card>
          <CardHeader>
            <CardTitle>Next Steps</CardTitle>
            <CardDescription>Get started with your project</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="list-inside list-disc space-y-2 text-muted-foreground">
              <li>Run <code className="rounded bg-muted px-1">gkm openapi</code> to generate typed API client</li>
              <li>Edit <code className="rounded bg-muted px-1">apps/web/src/app/page.tsx</code> to customize this page</li>
              <li>Add API routes in <code className="rounded bg-muted px-1">apps/api/src/endpoints/</code></li>
              <li>Add UI components with <code className="rounded bg-muted px-1">npx shadcn@latest add</code> in packages/ui</li>
            </ul>
            <div className="flex gap-4">
              <Button>Get Started</Button>
              <Button variant="outline">Documentation</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
`;

	// Environment file for web app
	const envLocal = `# API URL for client-side requests
NEXT_PUBLIC_API_URL=http://localhost:3000
`;

	// .gitignore for Next.js
	const gitignore = `.next/
node_modules/
.env.local
*.log
`;

	return [
		{
			path: 'apps/web/package.json',
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{
			path: 'apps/web/next.config.ts',
			content: nextConfig,
		},
		{
			path: 'apps/web/postcss.config.mjs',
			content: postcssConfig,
		},
		{
			path: 'apps/web/tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{
			path: 'apps/web/src/app/globals.css',
			content: globalsCss,
		},
		{
			path: 'apps/web/src/app/layout.tsx',
			content: layoutTsx,
		},
		{
			path: 'apps/web/src/app/providers.tsx',
			content: providersTsx,
		},
		{
			path: 'apps/web/src/app/page.tsx',
			content: pageTsx,
		},
		{
			path: 'apps/web/src/lib/query-client.ts',
			content: queryClientTs,
		},
		{
			path: 'apps/web/src/api/index.ts',
			content: apiIndexTs,
		},
		{
			path: 'apps/web/.env.local',
			content: envLocal,
		},
		{
			path: 'apps/web/.gitignore',
			content: gitignore,
		},
	];
}
