import type { GeneratedFile, TemplateOptions } from '../templates/index.js';

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

	// App layout
	const layoutTsx = `import type { Metadata } from 'next';

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
      <body>{children}</body>
    </html>
  );
}
`;

	// Home page with API example
	const pageTsx = `import type { User } from '${modelsPackage}';

export default async function Home() {
  // Example: Fetch from API
  const apiUrl = process.env.API_URL || 'http://localhost:3000';
  let health = null;

  try {
    const response = await fetch(\`\${apiUrl}/health\`, {
      cache: 'no-store',
    });
    health = await response.json();
  } catch (error) {
    console.error('Failed to fetch health:', error);
  }

  // Example: Type-safe model usage
  const exampleUser: User = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'user@example.com',
    name: 'Example User',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

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
          <p>Unable to connect to API at {apiUrl}</p>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Shared Models</h2>
        <p>This user object is typed from @${options.name}/models:</p>
        <pre style={{ background: '#f0f0f0', padding: '1rem', borderRadius: '8px' }}>
          {JSON.stringify(exampleUser, null, 2)}
        </pre>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Next Steps</h2>
        <ul>
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
	const envLocal = `# API URL (injected automatically in workspace mode)
API_URL=http://localhost:3000

# Other environment variables
# NEXT_PUBLIC_API_URL=http://localhost:3000
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
			path: 'apps/web/src/app/page.tsx',
			content: pageTsx,
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
