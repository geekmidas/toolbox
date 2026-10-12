import { provideKey, schemeBase } from '@geekmidas/manifest';
import { emailFor } from '../constructs.js';
import {
	DEPENDENCY_VERSIONS,
	EXPO_VERSIONS,
	TOOLCHAIN_VERSIONS,
} from '../dependencies.js';
import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

/**
 * The fullstack template's mobile app, when it has one (`mobileApp`).
 *
 * NativeWind for styling, expo-router for navigation, React Query for data,
 * wired into the toolbox's typed API client — and signing in with an emailed
 * link, through `@<name>/auth/client`'s provider and hooks, the same ones the
 * web site and the admin panel use. Its construct, `constructs/app.ts`, is
 * written here too: the app is what makes it exist.
 */
export function generateExpoAppFiles(
	options: TemplateOptions,
): GeneratedFile[] {
	if (
		!options.monorepo ||
		options.template !== 'fullstack' ||
		!options.mobileApp
	) {
		return [];
	}

	const packageName = `@${options.name}/app`;
	const modelsPackage = `@${options.name}/models`;
	const authPackage = `@${options.name}/auth`;
	// The slug is Expo's project name. The scheme — and the bundle id built on
	// it — is not written here: the \`MobileApp\` construct resolves it per
	// stage, and \`app.config.ts\` reads it from \`APP_SCHEME\`.
	const slug = options.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
	// What the deployed auth server trusts: the same derivation, not a copy.
	const scheme = schemeBase(options.name);
	// Mailpit's inbox, which the construct's edge to the mailer publishes on a
	// local stage: `EXPO_PUBLIC_<MAILER>_INBOX_URL`, derived as it derives it.
	const inboxKey = `EXPO_PUBLIC_${provideKey(emailFor().id, 'inboxUrl')}`;

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
			[modelsPackage]: 'workspace:*',
			[authPackage]: 'workspace:*',
			'@better-auth/expo': DEPENDENCY_VERSIONS['better-auth'],
			'@geekmidas/client': GEEKMIDAS_VERSIONS['@geekmidas/client'],
			'@geekmidas/envkit': GEEKMIDAS_VERSIONS['@geekmidas/envkit'],
			'@react-navigation/native': EXPO_VERSIONS['@react-navigation/native'],
			'@tanstack/react-query': DEPENDENCY_VERSIONS['@tanstack/react-query'],
			'better-auth': DEPENDENCY_VERSIONS['better-auth'],
			expo: EXPO_VERSIONS['expo'],
			'expo-constants': EXPO_VERSIONS['expo-constants'],
			'expo-dev-client': EXPO_VERSIONS['expo-dev-client'],
			'expo-device': EXPO_VERSIONS['expo-device'],
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
			'react-native-worklets': EXPO_VERSIONS['react-native-worklets'],
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

	const appConfig = `import type { ConfigContext, ExpoConfig } from 'expo/config';
import { EnvironmentParser } from '@geekmidas/envkit';

/**
 * What the app is built with, from the environment \`gkm\` injects — the
 * \`MobileApp\` construct's \`.dependsOn([api, auth])\` is where every value
 * here comes from, so none of it is written down.
 *
 * - \`APP_SCHEME\`: the URL scheme — \`${scheme}\`, the same on every stage.
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
				// Every API's client, generated at the workspace root.
				[`@${options.name}/client/*`]: ['../../.gkm/client/*'],
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
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import type { Config } from './app.config.ts';

const built = Constants.expoConfig?.extra?.config as Config;

/** The host this device loaded the bundle from: Metro's, as the device sees it. */
const metro = (Constants.expoConfig?.hostUri ?? '').split(':')[0];

/**
 * A private address on the local network — what a phone on the same Wi-Fi
 * reaches this machine on. A tunnel's \`*.exp.direct\` host is not one: a
 * tunnel forwards only Metro, so the servers are not behind it.
 */
const isLan = (host: string) =>
  /^10\\./.test(host) ||
  /^192\\.168\\./.test(host) ||
  /^172\\.(1[6-9]|2\\d|3[01])\\./.test(host);

/** \`localhost\` from inside the Android emulator is the emulator itself. */
const isAndroidEmulator = Platform.OS === 'android' && !Device.isDevice;

/**
 * A server's URL as this device reaches it.
 *
 * Locally the servers are injected as \`http://localhost:<port>\`. That is this
 * device only on the iOS simulator. The Android emulator reaches this machine
 * at \`10.0.2.2\`, and a phone at the LAN address Metro was served from.
 * Deployed URLs have no \`localhost\` in them and pass through untouched.
 */
export function reachable(url: string): string {
  const host = isLan(metro) ? metro : isAndroidEmulator ? '10.0.2.2' : undefined;
  if (!host) return url;
  return url.replace(/\\/\\/(localhost|127\\.0\\.0\\.1)(?=[:/]|$)/, \`//\${host}\`);
}

export const config = {
  scheme: built.scheme,
  apiUrl: reachable(built.apiUrl),
  authUrl: reachable(built.authUrl),
  /**
   * Mailpit's inbox, where a sign-in link sent locally is read: the
   * \`MobileApp\` construct's edge to the mailer publishes it on a local stage
   * only, so it is unset in a store build. Written as the literal
   * \`process.env.EXPO_PUBLIC_…\`, the only form Metro inlines.
   */
  mailerInboxUrl: optional(process.env.${inboxKey}),
};

function optional(value: string | undefined): string | undefined {
  return value ? reachable(value) : undefined;
}
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

	const authClientTs = `import { expoClient, getSetCookie } from '@better-auth/expo/client';
import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';

import { config } from '@/config.ts';

/** Where the Expo client keeps the session, in the device's secure store. */
export const STORAGE_PREFIX = config.scheme;
export const COOKIE_STORE_KEY = \`\${STORAGE_PREFIX}_cookie\`;

/**
 * Better Auth, as the app talks to it: the auth server at the address this
 * device reaches (\`config.ts\`), its session cookie kept in the secure store
 * rather than a cookie jar, and the app's scheme as its origin — which the
 * auth server trusts because \`constructs/app.ts\` depends on it.
 *
 * Handed to \`<AuthProvider>\` in the root layout, so every screen signs in
 * through \`${authPackage}/client\`'s hooks, as the web site does.
 */
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

/**
 * Keep the session an emailed link brought back (\`app/signing-in.tsx\`).
 *
 * The link opens in the phone's browser, which is what receives the session
 * cookie — not the app. The auth server's Expo plugin carries the cookie on
 * the redirect back into the app (\`?cookie=\`), and this stores it where the
 * Expo client keeps its own, merged with what is already there, then tells
 * the client the session changed. The Expo client does this itself only for a
 * sign-in it opened; a link opened from mail arrives as a deep link.
 */
export async function keepSessionFromLink(cookie: string) {
  const previous = await SecureStore.getItemAsync(COOKIE_STORE_KEY);
  await SecureStore.setItemAsync(
    COOKIE_STORE_KEY,
    getSetCookie(cookie, previous ?? undefined),
  );
  authClient.$store.notify('$sessionSignal');
}

/**
 * Sign out on the server, and forget the session here even if that fails —
 * a phone offline still signs out.
 */
export async function signOut() {
  try {
    await authClient.signOut();
  } finally {
    await SecureStore.deleteItemAsync(COOKIE_STORE_KEY);
    authClient.$store.notify('$sessionSignal');
  }
}
`;

	const openedLinkTs = `import { LINK_ROUTE } from '${authPackage}/magic-link';

/**
 * The last sign-in link the app was opened with. A newer one replaces it, and
 * a reload starts without one.
 *
 * Kept as it arrived rather than read from the router's params: the router
 * decodes a query as a form does, \`+\` to a space, and the session cookie's
 * signature is base64 — a \`+\` in it became a space, and the auth server,
 * unable to verify it, answered as if no one were signed in.
 */
let opened: string | null = null;

/**
 * Keep \`link\` if it is a sign-in link: called from \`app/+native-intent.tsx\`,
 * which sees every incoming link as it arrived — the one that launched the
 * app and any opened while it runs — before the router decodes it.
 */
export function rememberLink(link: string): void {
  // \`<scheme>:///signing-in?…\` (the Expo client's form), \`<scheme>://…\` or
  // \`/signing-in?…\`: the scheme and every leading slash off, then one back.
  const path = \`/\${link.replace(/^[a-z][a-z0-9+.-]*:/i, '').replace(/^\\/+/, '')}\`;
  if (path === LINK_ROUTE || path.startsWith(\`\${LINK_ROUTE}?\`)) opened = link;
}

/** The sign-in link the app was last opened with: null if there was none. */
export function openedLink(): string | null {
  return opened;
}
`;

	const openMailTs = `/** What opening the mail app needs. */
export interface MailOpener {
  /** \`config.mailerInboxUrl\`: Mailpit's inbox, on the local stage only. */
  inboxUrl: string | undefined;
  /** \`Platform.OS\`. */
  os: string;
  /** \`Linking.openURL\`. */
  openURL: (url: string) => Promise<unknown>;
}

/**
 * Where **Open email app** goes: Mailpit's inbox when the stage has one, so a
 * sign-in link sent in development is read on the device; otherwise Mail on
 * iOS and, on Android, whatever answers \`mailto:\`.
 */
export function mailAppUrl({ inboxUrl, os }: Omit<MailOpener, 'openURL'>) {
  if (inboxUrl) return inboxUrl;
  return os === 'ios' ? 'message:' : 'mailto:';
}

/** Open it; a device with nothing to open it with does nothing. */
export function openMailApp(opener: MailOpener): void {
  void opener.openURL(mailAppUrl(opener)).catch(() => {
    // \`openURL\` rejects only when nothing on the device opens the URL. The
    // button is a shortcut; the link is still in the inbox.
  });
}
`;
	const apiTs = `import { createApi } from '@${options.name}/client/api';

import { config } from '@/config.ts';
import { authClient } from './auth-client.ts';
import { queryClient } from './query-client.ts';

export function createAppApi(options?: { headers?: Record<string, string> }) {
  return createApi({
    baseURL: config.apiUrl,
    queryClient,
    headers: options?.headers,
    // The session is the cookie the Expo client keeps in the secure store,
    // sent by hand: React Native has no cookie jar to send it for us.
    onRequest: async (cfg): Promise<RequestInit> => {
      const headers = new Headers(cfg.headers);
      const cookie = await authClient.getCookie();
      if (cookie) headers.set('Cookie', cookie);
      return { ...cfg, credentials: 'omit', headers };
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

	const emailLinkFormTsx = `import {
  type LinkRequest,
  useRequestSignInLink,
} from '${authPackage}/client';
import { EmailSchema, LINK_ROUTE } from '${authPackage}/magic-link';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

/**
 * An email address and a button that mails it a sign-in link.
 *
 * The address is checked the way the auth server checks it (\`EmailSchema\`),
 * and a refusal — too many links asked for, an address it does not take, no
 * answer — is said in the words \`useRequestSignInLink\` gives it. Whether the
 * address has an account is never part of the answer: a new one gets one when
 * its link is opened.
 *
 * The link opens the app at \`LINK_ROUTE\` (\`app/signing-in.tsx\`); the Expo
 * client turns that path into a link to the app.
 */
export function EmailLinkForm({
  initialEmail = '',
  submitLabel = 'Email me a sign-in link',
  onSent,
}: {
  initialEmail?: string;
  submitLabel?: string;
  onSent: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [invalid, setInvalid] = useState<string>();
  const { request, pending, result, reset } = useRequestSignInLink({
    callbackURL: LINK_ROUTE,
  });

  async function submit() {
    const parsed = EmailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message);
      return;
    }
    setInvalid(undefined);
    const sent: LinkRequest = await request(parsed.data);
    if (sent.sent) onSent(parsed.data);
  }

  const error = invalid ?? (result && !result.sent ? result.message : undefined);

  return (
    <View className="gap-2">
      <Text className="text-xs font-semibold uppercase text-slate-500">
        Email
      </Text>
      <TextInput
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          setInvalid(undefined);
          reset();
        }}
        onSubmitEditing={submit}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        placeholder="you@example.com"
        placeholderTextColor="#94a3b8"
        editable={!pending}
        className="rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
      />
      {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
      <Pressable
        onPress={submit}
        disabled={pending}
        className="mt-4 items-center rounded-lg bg-slate-900 py-4 disabled:opacity-60"
      >
        <Text className="font-semibold text-white">
          {pending ? 'Sending…' : submitLabel}
        </Text>
      </Pressable>
    </View>
  );
}
`;

	const layoutTsx = `import '../global.css';

import { AuthProvider, useSession } from '${authPackage}/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import 'react-native-reanimated';

import { ApiProvider } from '@/lib/api-context.tsx';
import { createAppApi } from '@/lib/api.ts';
import { authClient } from '@/lib/auth-client.ts';
import { queryClient } from '@/lib/query-client.ts';

export default function RootLayout() {
  const api = useMemo(() => createAppApi(), []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* The same provider and hooks as the web site and the admin panel;
          only the client — the Expo one, keeping the session in the secure
          store — is the app's own. */}
      <AuthProvider client={authClient}>
        <ApiProvider api={api}>
          <Gate />
          <StatusBar style="auto" />
        </ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * Which screens someone sees: the app's when signed in, \`(auth)\` when not.
 *
 * \`/signing-in\` is reachable either way — it is where an emailed link opens
 * the app, signed in or not — so the gate never sends a link away before it
 * has been read. The session decides only what is drawn; the API checks it on
 * every request.
 */
function Gate() {
  const { data: session, isPending } = useSession();
  // The splash stays up until the session is known.
  if (isPending) return null;
  const signedIn = Boolean(session);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Screen name="signing-in" />
    </Stack>
  );
}
`;

	const nativeIntentTsx = `import { rememberLink } from '@/lib/opened-link.ts';

/**
 * Every link the app is opened with passes through here as it arrived, before
 * the router decodes it. A sign-in link is kept for \`signing-in.tsx\`, which
 * needs its \`?cookie=\` exactly as sent. The path is unchanged.
 */
export function redirectSystemPath({ path }: { path: string }): string {
  try {
    rememberLink(path);
  } catch {
    // Never let keeping a link stop the app from opening it.
  }
  return path;
}
`;

	const indexTsx = `import { useSession } from '${authPackage}/client';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/lib/api-context.tsx';
import { signOut } from '@/lib/auth-client.ts';

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

	const authLayoutTsx = `import { Stack } from 'expo-router';

/**
 * Signing in, for someone who is not: the root layout shows this group only
 * while signed out.
 */
export default function AuthLayout() {
  return (
    <Stack initialRouteName="continue" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="continue" />
      <Stack.Screen name="check-email" />
    </Stack>
  );
}
`;

	const continueTsx = `import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmailLinkForm } from '@/components/email-link-form.tsx';

/**
 * Continue: sign in or sign up with an emailed link — one flow, an account is
 * made when there is none.
 *
 * \`?fresh=\` is set by **Use a different email**: a new value starts the form
 * again, empty.
 */
export default function ContinueScreen() {
  const { fresh } = useLocalSearchParams<{ fresh?: string }>();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-center gap-6 px-6">
          <View className="gap-1">
            <Text className="text-3xl font-bold text-slate-900">
              Sign in to ${options.name}
            </Text>
            <Text className="text-sm text-slate-500">
              Continue with your email. New here? We'll set up your account.
            </Text>
          </View>
          <EmailLinkForm
            key={fresh}
            onSent={(email) =>
              router.push({ pathname: '/check-email', params: { email } })
            }
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
`;

	const checkEmailTsx = `import { useRequestSignInLink } from '${authPackage}/client';
import { LINK_ROUTE, MAGIC_LINK_MINUTES } from '${authPackage}/magic-link';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { config } from '@/config.ts';
import { openMailApp } from '@/lib/open-mail.ts';

/** Back to Continue, with the email field empty. */
function useDifferentEmail() {
  router.dismissTo({
    pathname: '/continue',
    params: { fresh: String(Date.now()) },
  });
}

/** Check your email: opened from Continue once a link is sent. */
export default function CheckEmailScreen() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const { request, pending, result } = useRequestSignInLink({
    callbackURL: LINK_ROUTE,
  });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 justify-center gap-6 px-6">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-slate-900">
            Check your email
          </Text>
          <Text className="text-slate-500">
            We sent a sign-in link to{' '}
            <Text className="font-semibold text-slate-900">{email}</Text>. It
            works once, for {MAGIC_LINK_MINUTES} minutes.
          </Text>
        </View>

        <Pressable
          onPress={() =>
            openMailApp({
              inboxUrl: config.mailerInboxUrl,
              os: Platform.OS,
              openURL: (url) => Linking.openURL(url),
            })
          }
          className="items-center rounded-lg bg-slate-900 py-4"
        >
          <Text className="font-semibold text-white">Open email app</Text>
        </Pressable>

        <View className="items-center gap-3">
          <Pressable
            onPress={() => request(email)}
            disabled={pending || !email}
            className="disabled:opacity-60"
          >
            <Text className="font-semibold text-slate-900">
              {pending ? 'Sending…' : 'Send it again'}
            </Text>
          </Pressable>
          {result ? (
            <Text
              className={result.sent ? 'text-sm text-slate-500' : 'text-sm text-red-600'}
            >
              {result.sent ? 'Sent. Check your inbox.' : result.message}
            </Text>
          ) : null}
          <Pressable onPress={useDifferentEmail}>
            <Text className="text-slate-500">Use a different email</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
`;

	const signingInTsx = `import { landing, linkParams, type Landing } from '${authPackage}/client';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmailLinkForm } from '@/components/email-link-form.tsx';
import { authClient, keepSessionFromLink } from '@/lib/auth-client.ts';
import { openedLink } from '@/lib/opened-link.ts';

/** A link with no session in it: there is nothing to sign in with. */
const FAILED: Landing = { signedIn: false, reason: 'failed' };

/**
 * Where an emailed sign-in link opens the app (\`LINK_ROUTE\`), signed in or
 * not — the root layout's gate never sends it away.
 *
 * The link carries the session (\`?cookie=\`); once it is kept and the auth
 * server confirms it, the app opens. A link that was used or ran out lands
 * here too, with \`?error=\` and the address it went to: **This link has
 * expired**, with a new one a tap away.
 */
export default function SigningInScreen() {
  // The link as it arrived (\`+native-intent.tsx\`); none when this screen is
  // reached any other way, such as a reload while it was open.
  const [result] = useState<Landing>(() => {
    const link = openedLink();
    if (!link) return FAILED;
    const landed = landing(linkParams(link));
    // On the app the session is the link's \`?cookie=\`: without one, the
    // link signed no one in.
    return landed.signedIn && !landed.cookie ? FAILED : landed;
  });
  const cookie = result.signedIn ? result.cookie : undefined;
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!cookie) return;
    let current = true;
    void (async () => {
      await keepSessionFromLink(cookie);
      const { data } = await authClient.getSession();
      if (!current) return;
      if (data) router.replace('/');
      else setRefused(true);
    })();
    return () => {
      current = false;
    };
  }, [cookie]);

  if (cookie && !refused) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const expired = !result.signedIn && result.reason === 'expired';
  const email = !result.signedIn && result.reason === 'expired' ? result.email : undefined;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 justify-center gap-6 px-6">
        <View className="gap-2">
          <Text className="text-3xl font-bold text-slate-900">
            {expired ? 'This link has expired' : "That link didn't sign you in"}
          </Text>
          <Text className="text-slate-500">
            {expired
              ? 'Sign-in links work once, for a short while. Send a new one.'
              : 'Something went wrong opening it. Ask for a new link.'}
          </Text>
        </View>
        <EmailLinkForm
          initialEmail={email}
          submitLabel="Send a new link"
          onSent={(to) =>
            router.replace({ pathname: '/check-email', params: { email: to } })
          }
        />
        <Pressable onPress={() => router.replace('/continue')}>
          <Text className="text-center text-slate-500">Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
`;

	const appConstructTs = `import { MobileApp } from '@geekmidas/constructs/mobile-app';
import { api } from './api.ts';
import { auth } from './auth.ts';
import { email } from './email.ts';

/**
 * The mobile app — a construct like a site, which is what makes it an app.
 *
 * \`.dependsOn()\` is the single fact behind what a mobile app otherwise has
 * written down by hand: its API and auth URLs, its URL scheme, the scheme in
 * the auth server's trusted origins, Better Auth's Expo plugin, sign-in links
 * a phone can open — and, on a local stage, the mailer's inbox, so a link sent
 * in development is read on the device.
 */
export const app = new MobileApp('App', { path: 'apps/app' }).dependsOn([
  api,
  auth,
  email,
]);
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
		{ path: 'apps/app/lib/opened-link.ts', content: openedLinkTs },
		{ path: 'apps/app/lib/open-mail.ts', content: openMailTs },
		{ path: 'apps/app/lib/api.ts', content: apiTs },
		{ path: 'apps/app/lib/api-context.tsx', content: apiContextTsx },
		{
			path: 'apps/app/components/email-link-form.tsx',
			content: emailLinkFormTsx,
		},
		{ path: 'apps/app/app/_layout.tsx', content: layoutTsx },
		{ path: 'apps/app/app/+native-intent.tsx', content: nativeIntentTsx },
		{ path: 'apps/app/app/index.tsx', content: indexTsx },
		{ path: 'apps/app/app/(auth)/_layout.tsx', content: authLayoutTsx },
		{ path: 'apps/app/app/(auth)/continue.tsx', content: continueTsx },
		{ path: 'apps/app/app/(auth)/check-email.tsx', content: checkEmailTsx },
		{ path: 'apps/app/app/signing-in.tsx', content: signingInTsx },
		{ path: 'apps/app/.gitignore', content: gitignore },
		{ path: 'constructs/app.ts', content: appConstructTs },
	];
}
