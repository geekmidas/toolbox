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
			'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
			'@tanstack/react-query': '~5.80.0',
			next: '~16.1.0',
			react: '~19.2.0',
			'react-dom': '~19.2.0',
		},
		devDependencies: {
			'@types/node': '~22.0.0',
			'@types/react': '~19.0.0',
			'@types/react-dom': '~19.0.0',
			typescript: '~5.8.2',
		},
	};

	// next.config.ts
	const nextConfig = `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['${modelsPackage}'],
};

export default nextConfig;
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
				'@/*': ['./src/*'],
				[`${modelsPackage}`]: ['../../packages/models/src'],
				[`${modelsPackage}/*`]: ['../../packages/models/src/*'],
			},
			baseUrl: '.',
		},
		include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
		exclude: ['node_modules'],
	};

	// Providers with QueryClient
	const providersTsx = `'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
`;

	// API client setup
	const apiIndexTs = `import { TypedFetcher } from '@geekmidas/client/fetcher';
import { createEndpointHooks } from '@geekmidas/client/endpoint-hooks';

// TODO: Run 'gkm openapi' to generate typed paths from your API
// This is a placeholder that will be replaced by the generated openapi.ts
interface paths {
  '/health': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': { status: string; timestamp: string };
          };
        };
      };
    };
  };
  '/users': {
    get: {
      responses: {
        200: {
          content: {
            'application/json': { users: Array<{ id: string; name: string }> };
          };
        };
      };
    };
  };
}

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const fetcher = new TypedFetcher<paths>({ baseURL });

const hooks = createEndpointHooks<paths>(fetcher.request.bind(fetcher));

export const api = Object.assign(fetcher.request.bind(fetcher), hooks);
`;

	// App layout
	const layoutTsx = `import type { Metadata } from 'next';
import { Providers } from './providers';

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

	// Home page with API example
	const pageTsx = `import { api } from '@/api';

export default async function Home() {
  // Type-safe API call using the generated client
  const health = await api('GET /health').catch(() => null);

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Welcome to ${options.name}</h1>

      <section style={{ marginTop: '2rem' }}>
        <h2>API Status</h2>
        {health ? (
          <pre style={{ background: '#f0f0f0', padding: '1rem', borderRadius: '8px' }}>
            {JSON.stringify(health, null, 2)}
          </pre>
        ) : (
          <p>Unable to connect to API</p>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Next Steps</h2>
        <ul>
          <li>Run <code>gkm openapi</code> to generate typed API client</li>
          <li>Edit <code>apps/web/src/app/page.tsx</code> to customize this page</li>
          <li>Add API routes in <code>apps/api/src/endpoints/</code></li>
          <li>Define shared schemas in <code>packages/models/src/</code></li>
        </ul>
      </section>
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
			path: 'apps/web/tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
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
