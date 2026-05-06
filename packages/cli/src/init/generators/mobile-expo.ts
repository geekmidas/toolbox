import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * Generate an Expo mobile app for the fullstack template.
 *
 * Mirrors the structure of rezgo/apps/app: NativeWind for styling,
 * expo-router for navigation, better-auth + magic link, React Query
 * for data, all wired into the toolbox's typed API client.
 */
export function generateExpoAppFiles(
	options: TemplateOptions,
): GeneratedFile[] {
	if (!options.monorepo || options.template !== 'fullstack') {
		return [];
	}

	const packageName = `@${options.name}/app`;
	const apiPackage = `@${options.name}/api`;
	const modelsPackage = `@${options.name}/models`;
	// Expo bundle id / scheme — kept simple; the user can rename later.
	const slug = options.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
	const scheme = slug.replace(/-/g, '');
	const bundleId = `com.${scheme}.app`;

	const packageJson = {
		name: packageName,
		version: '0.0.1',
		main: 'expo-router/entry',
		private: true,
		scripts: {
			dev: 'gkm exec -- expo start -c',
			ios: 'expo start --ios',
			android: 'expo start --android',
			web: 'expo start --web',
			typecheck: 'tsc --noEmit',
		},
		dependencies: {
			[apiPackage]: 'workspace:*',
			[modelsPackage]: 'workspace:*',
			'@better-auth/expo': '~1.2.0',
			'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@react-navigation/native': '^7.1.0',
			'@tanstack/react-query': '~5.80.0',
			'better-auth': '~1.2.0',
			expo: '~55.0.0',
			'expo-constants': '~55.0.0',
			'expo-dev-client': '~55.0.0',
			'expo-linking': '~55.0.0',
			'expo-router': '~55.0.0',
			'expo-secure-store': '~14.2.0',
			'expo-splash-screen': '~55.0.0',
			'expo-status-bar': '~55.0.0',
			nativewind: '~4.2.0',
			react: '19.2.0',
			'react-dom': '19.2.0',
			'react-native': '0.83.6',
			'react-native-gesture-handler': '~2.30.0',
			'react-native-reanimated': '~4.2.0',
			'react-native-safe-area-context': '~5.6.0',
			'react-native-screens': '~4.23.0',
			'react-native-web': '~0.21.0',
			tailwindcss: '~3.4.0',
		},
		devDependencies: {
			'@babel/core': '^7.25.0',
			'@types/react': '~19.0.0',
			typescript: '~5.8.2',
		},
	};

	const appConfig = `import type { ConfigContext, ExpoConfig } from '@expo/config';

/**
 * Expo runtime config. Public env vars (\`EXPO_PUBLIC_*\`) are inlined
 * at build time; everything else is read at runtime from \`extra\`.
 */
export default function config(_context: ConfigContext): ExpoConfig {
  return {
    name: '${options.name}',
    slug: '${slug}',
    version: '0.0.1',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: '${scheme}',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: '${bundleId}',
    },
    android: {
      package: '${bundleId}',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
    },
    web: {
      output: 'static',
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-splash-screen',
        {
          image: './assets/splash.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
  };
}
`;

	const easJson = {
		cli: {
			version: '>= 10.2.1',
			appVersionSource: 'remote',
		},
		build: {
			dev: {
				developmentClient: true,
				distribution: 'internal',
				environment: 'development',
				env: {
					EXPO_PUBLIC_API_URL: 'http://localhost:3000',
					EXPO_PUBLIC_AUTH_URL: 'http://localhost:3002',
				},
			},
			preview: {
				distribution: 'internal',
				environment: 'preview',
				env: {
					EXPO_PUBLIC_API_URL: 'https://api.example.com',
					EXPO_PUBLIC_AUTH_URL: 'https://auth.example.com',
				},
			},
			production: {
				autoIncrement: true,
				environment: 'production',
				env: {
					EXPO_PUBLIC_API_URL: 'https://api.example.com',
					EXPO_PUBLIC_AUTH_URL: 'https://auth.example.com',
				},
			},
		},
	};

	const babelConfig = `module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
`;

	const metroConfig = `const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
`;

	const tsConfig = {
		extends: 'expo/tsconfig.base',
		compilerOptions: {
			strict: true,
			allowImportingTsExtensions: true,
			types: ['nativewind/types'],
			paths: {
				'@/*': ['./*'],
				[modelsPackage]: ['../../packages/models/src'],
				[`${modelsPackage}/*`]: ['../../packages/models/src/*'],
				[`${apiPackage}/client`]: ['../../apps/api/.gkm/openapi.ts'],
			},
		},
		include: [
			'**/*.ts',
			'**/*.tsx',
			'.expo/types/**/*.ts',
			'expo-env.d.ts',
			'nativewind-env.d.ts',
		],
	};

	const tailwindConfig = `import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
`;

	const globalCss = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;

	const expoEnvDts = `/// <reference types="expo/types" />\n`;

	const nativewindEnvDts = `/// <reference types="nativewind/types" />\n`;

	const configTs = `import { EnvironmentParser } from '@geekmidas/envkit';

/**
 * Public app config. EXPO_PUBLIC_* vars are inlined into the bundle at
 * build time, so they're safe to read in client code.
 */
const envParser = new EnvironmentParser({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_AUTH_URL: process.env.EXPO_PUBLIC_AUTH_URL,
});

export const config = envParser
  .create((get) => ({
    apiUrl: get('EXPO_PUBLIC_API_URL').string(),
    authUrl: get('EXPO_PUBLIC_AUTH_URL').string(),
  }))
  .parse();
`;

	const queryClientTs = `import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
    },
  },
});
`;

	const authClientTs = `import { expoClient } from '@better-auth/expo/client';
import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';

import { config } from '@/config.ts';

export const STORAGE_PREFIX = '${scheme}';
export const COOKIE_STORE_KEY = \`\${STORAGE_PREFIX}_cookie\`;

export const authClient = createAuthClient({
  baseURL: config.authUrl,
  plugins: [
    expoClient({
      scheme: '${scheme}',
      storagePrefix: STORAGE_PREFIX,
      storage: SecureStore,
    }),
    magicLinkClient(),
  ],
});

export const { signIn, useSession } = authClient;

export async function signOut() {
  try {
    await authClient.signOut();
  } finally {
    await SecureStore.deleteItemAsync(COOKIE_STORE_KEY);
  }
}
`;

	const apiTs = `import { createApi } from '${apiPackage}/client';

import { config } from '@/config.ts';
import { authClient } from './auth-client.ts';
import { queryClient } from './query-client.ts';

export function createAppApi(options?: { headers?: Record<string, string> }) {
  return createApi({
    baseURL: config.apiUrl,
    queryClient,
    headers: options?.headers,
    onRequest: (cfg) => {
      const cookie = authClient.getCookie();
      const next = { ...cfg, credentials: 'omit' as const };
      if (cookie) {
        return {
          ...next,
          headers: { ...(next.headers ?? {}), Cookie: cookie },
        };
      }
      return next;
    },
  });
}
`;

	const apiContextTsx = `import { createContext, type ReactNode, use } from 'react';
import type { createAppApi } from './api.ts';

export type Api = ReturnType<typeof createAppApi>;

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({
  api,
  children,
}: {
  api: Api;
  children: ReactNode;
}) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = use(ApiContext);
  if (!api) {
    throw new Error('useApi must be used within an ApiProvider');
  }
  return api;
}
`;

	const layoutTsx = `import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import 'react-native-reanimated';

import { authClient } from '@/lib/auth-client.ts';
import { ApiProvider } from '@/lib/api-context.tsx';
import { createAppApi } from '@/lib/api.ts';
import { queryClient } from '@/lib/query-client.ts';

function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (isPending) return;
    const onAuthRoute = segments[0] === 'login';
    if (!session && !onAuthRoute) {
      router.replace('/login');
    } else if (session && onAuthRoute) {
      router.replace('/');
    }
  }, [isPending, session, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  const api = useMemo(() => createAppApi(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
          </Stack>
        </AuthGate>
        <StatusBar style="auto" />
      </ApiProvider>
    </QueryClientProvider>
  );
}
`;

	const indexTsx = `import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signOut, useSession } from '@/lib/auth-client.ts';
import { useApi } from '@/lib/api-context.tsx';

export default function Home() {
  const { data: session } = useSession();
  const api = useApi();
  const { data: health } = api.useQuery('GET /health', {});

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center gap-4 px-6">
        <Text className="text-3xl font-bold text-slate-900">
          Welcome to ${options.name}
        </Text>
        {session ? (
          <Text className="text-sm text-slate-500">
            Signed in as {session.user.email}
          </Text>
        ) : null}
        {health ? (
          <Text className="text-xs text-slate-400">
            API: {JSON.stringify(health)}
          </Text>
        ) : null}
        <Pressable
          onPress={signOut}
          className="mt-4 rounded-lg bg-slate-900 px-6 py-3"
        >
          <Text className="font-semibold text-white">Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
`;

	const loginTsx = `import * as Linking from 'expo-linking';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authClient } from '@/lib/auth-client.ts';

const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address');
      return;
    }
    setError(null);
    setSubmitting(true);

    const callbackURL = Linking.createURL('/').replace(/^(\\w+):\\/\\/\\//, '$1://');
    try {
      const result = await authClient.signIn.magicLink({
        email: email.trim(),
        callbackURL,
      });
      if (result.error) {
        setError(result.error.message ?? 'Could not send magic link');
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-2xl font-bold text-slate-900">
            Check your inbox
          </Text>
          <Text className="mt-3 text-center text-slate-500">
            We sent a sign-in link to {email.trim()}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          <Text className="text-3xl font-bold text-slate-900">Sign in</Text>
          <Text className="mt-1 text-sm text-slate-500">
            We'll email you a one-time sign-in link.
          </Text>

          <Text className="mt-6 text-xs font-semibold uppercase text-slate-500">
            Email
          </Text>
          <TextInput
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (error) setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor="#94a3b8"
            editable={!submitting}
            className="mt-2 rounded-lg border border-slate-300 px-4 py-3"
          />
          {error ? (
            <Text className="mt-2 text-sm text-red-600">{error}</Text>
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            className="mt-6 items-center rounded-lg bg-slate-900 py-4 disabled:opacity-60"
          >
            <Text className="font-semibold text-white">
              {submitting ? 'Sending…' : 'Email me a sign-in link'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
`;

	const gitignore = `node_modules/
.expo/
dist/
*.log
.env*.local
ios/
android/
.eas/
`;

	return [
		{
			path: 'apps/app/package.json',
			content: `${JSON.stringify(packageJson, null, 2)}\n`,
		},
		{ path: 'apps/app/app.config.ts', content: appConfig },
		{
			path: 'apps/app/eas.json',
			content: `${JSON.stringify(easJson, null, 2)}\n`,
		},
		{ path: 'apps/app/babel.config.js', content: babelConfig },
		{ path: 'apps/app/metro.config.js', content: metroConfig },
		{
			path: 'apps/app/tsconfig.json',
			content: `${JSON.stringify(tsConfig, null, 2)}\n`,
		},
		{ path: 'apps/app/tailwind.config.ts', content: tailwindConfig },
		{ path: 'apps/app/global.css', content: globalCss },
		{ path: 'apps/app/expo-env.d.ts', content: expoEnvDts },
		{ path: 'apps/app/nativewind-env.d.ts', content: nativewindEnvDts },
		{ path: 'apps/app/config.ts', content: configTs },
		{ path: 'apps/app/lib/query-client.ts', content: queryClientTs },
		{ path: 'apps/app/lib/auth-client.ts', content: authClientTs },
		{ path: 'apps/app/lib/api.ts', content: apiTs },
		{ path: 'apps/app/lib/api-context.tsx', content: apiContextTsx },
		{ path: 'apps/app/app/_layout.tsx', content: layoutTsx },
		{ path: 'apps/app/app/index.tsx', content: indexTsx },
		{ path: 'apps/app/app/login.tsx', content: loginTsx },
		{ path: 'apps/app/.gitignore', content: gitignore },
	];
}
