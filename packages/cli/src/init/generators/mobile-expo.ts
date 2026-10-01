import { schemeBase } from '@geekmidas/manifest';
import {
	DEPENDENCY_VERSIONS,
	EXPO_VERSIONS,
	TOOLCHAIN_VERSIONS,
} from '../dependencies.js';
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
	// The slug is Expo's project name. The scheme — and the bundle id built on
	// it — is not written here: the \`MobileApp\` construct resolves it per
	// stage, and \`app.config.ts\` reads it from \`APP_SCHEME\`.
	const slug = options.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
	// What the deployed auth server trusts: the same derivation, not a copy.
	const scheme = schemeBase(options.name);

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
			'@better-auth/expo': DEPENDENCY_VERSIONS['better-auth'],
			'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@react-navigation/native': EXPO_VERSIONS['@react-navigation/native'],
			'@tanstack/react-query': DEPENDENCY_VERSIONS['@tanstack/react-query'],
			'better-auth': DEPENDENCY_VERSIONS['better-auth'],
			expo: EXPO_VERSIONS['expo'],
			'expo-constants': EXPO_VERSIONS['expo-constants'],
			'expo-dev-client': EXPO_VERSIONS['expo-dev-client'],
			'expo-linking': EXPO_VERSIONS['expo-linking'],
			'expo-router': EXPO_VERSIONS['expo-router'],
			'expo-secure-store': EXPO_VERSIONS['expo-secure-store'],
			'expo-splash-screen': EXPO_VERSIONS['expo-splash-screen'],
			'expo-status-bar': EXPO_VERSIONS['expo-status-bar'],
			nativewind: EXPO_VERSIONS['nativewind'],
			react: EXPO_VERSIONS['react'],
			'react-dom': EXPO_VERSIONS['react-dom'],
			'react-native': EXPO_VERSIONS['react-native'],
			'react-native-gesture-handler':
				EXPO_VERSIONS['react-native-gesture-handler'],
			'react-native-reanimated': EXPO_VERSIONS['react-native-reanimated'],
			'react-native-safe-area-context':
				EXPO_VERSIONS['react-native-safe-area-context'],
			'react-native-screens': EXPO_VERSIONS['react-native-screens'],
			'react-native-web': EXPO_VERSIONS['react-native-web'],
			tailwindcss: EXPO_VERSIONS['tailwindcss'],
		},
		devDependencies: {
			'@babel/core': EXPO_VERSIONS['@babel/core'],
			'@types/react': EXPO_VERSIONS['@types/react'],
			typescript: TOOLCHAIN_VERSIONS['typescript'],
		},
	};

	const appConfig = `import type { ConfigContext, ExpoConfig } from '@expo/config';
import { EnvironmentParser } from '@geekmidas/envkit';

/**
 * What the app is built with, from the environment \`gkm\` injects — the
 * \`MobileApp\` construct's \`.dependsOn([api, auth])\` is where every value
 * here comes from, so none of it is written down.
 *
 * - \`APP_SCHEME\`: the URL scheme for this stage — \`${scheme}\` deployed,
 *   \`${scheme}-dev\` locally, so a development build and the store build on
 *   one phone never answer each other's links.
 * - \`EXPO_PUBLIC_API_URL\` / \`EXPO_PUBLIC_AUTH_URL\`: where the servers
 *   answer. Locally that is their own port on \`localhost\`, which
 *   \`config.ts\` points at the machine Metro was served from.
 *
 * Read at runtime from \`Constants.expoConfig.extra.config\` — see \`config.ts\`.
 */
const config = new EnvironmentParser({ ...process.env })
  .create((get) => ({
    scheme: get('APP_SCHEME').string(),
    apiUrl: get('EXPO_PUBLIC_API_URL').string(),
    authUrl: get('EXPO_PUBLIC_AUTH_URL').string(),
  }))
  .parse();

export type Config = typeof config;

// A bundle id and an Android package allow no hyphens; one per scheme, so
// each stage installs beside the others.
const bundleId = \`com.\${config.scheme.replace(/[^a-z0-9]/g, '')}.app\`;

export default function expoConfig({ config: base }: ConfigContext): ExpoConfig {
  return {
    ...base,
    name: '${options.name}',
    slug: '${slug}',
    version: '0.0.1',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: config.scheme,
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: bundleId,
    },
    android: {
      package: bundleId,
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
    extra: { ...base.extra, config },
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
				// Locally \`gkm\` injects the scheme and both URLs from the graph.
				environment: 'development',
			},
			preview: {
				distribution: 'internal',
				environment: 'preview',
				// EAS builds outside \`gkm\`, so a store build is told its scheme —
				// the bare one, which is what the deployed auth server trusts.
				env: {
					APP_SCHEME: scheme,
					EXPO_PUBLIC_API_URL: 'https://api.example.com',
					EXPO_PUBLIC_AUTH_URL: 'https://auth.example.com',
				},
			},
			production: {
				autoIncrement: true,
				environment: 'production',
				// EAS builds outside \`gkm\`, so a store build is told its scheme —
				// the bare one, which is what the deployed auth server trusts.
				env: {
					APP_SCHEME: scheme,
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
				[`${apiPackage}/client`]: ['../../apps/api/.gkm/openapi/api.ts'],
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

	const configTs = `import Constants from 'expo-constants';

import type { Config } from './app.config.ts';

const built = Constants.expoConfig?.extra?.config as Config;

/**
 * The host this device loaded the bundle from — \`localhost\` on the iOS
 * simulator, \`10.0.2.2\` on the Android emulator, the machine's LAN address
 * on a phone. Whatever it is, the device has already reached it.
 */
const metro = (Constants.expoConfig?.hostUri ?? '').split(':')[0];

/**
 * A server's URL as this device reaches it.
 *
 * Locally the servers are injected as \`http://localhost:<port>\`, which is
 * this device only when it is the simulator; everywhere else \`localhost\` is
 * swapped for the host Metro was served from. Deployed URLs have no
 * \`localhost\` in them and pass through untouched.
 */
export function reachable(url: string): string {
  if (!metro || metro === 'localhost' || metro === '127.0.0.1') return url;
  return url.replace(/\\/\\/(localhost|127\\.0\\.0\\.1)(?=[:/]|$)/, \`//\${metro}\`);
}

export const config = {
  scheme: built.scheme,
  apiUrl: reachable(built.apiUrl),
  authUrl: reachable(built.authUrl),
};
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

export const STORAGE_PREFIX = config.scheme;
export const COOKIE_STORE_KEY = \`\${STORAGE_PREFIX}_cookie\`;

export const authClient = createAuthClient({
  baseURL: config.authUrl,
  plugins: [
    expoClient({
      scheme: config.scheme,
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
