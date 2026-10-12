import { DEPENDENCY_VERSIONS, EXPO_VERSIONS } from '../dependencies.js';
import type { GeneratedFile, TemplateOptions } from '../templates/index.js';

/**
 * One of the fullstack template's two sites: the public web site, or the
 * admin panel. The same framework builds both, and both sign in the same way
 * — the difference is what is behind the sign-in.
 */
export interface SiteApp {
	/** The app's folder name and package suffix: `web`, `admin`. */
	key: 'web' | 'admin';
	/** The construct's id: `Web`, `Admin`. */
	id: 'Web' | 'Admin';
	/** The construct's export: `web`, `admin`. */
	exportName: 'web' | 'admin';
	/** Where it lives, from the workspace root. */
	dir: string;
	/** What the browser tab says. */
	title: (options: TemplateOptions) => string;
}

/**
 * `src/lib/auth-client.ts`: Better Auth as this site talks to it — the auth
 * server at the URL the build inlined, with the magic link's client plugin.
 * Handed to `<AuthProvider>`, which every page's hooks read it from.
 */
export function authClientSource(configImport: string): string {
	return `import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { clientConfig } from '${configImport}';

export const authClient = createAuthClient({
  baseURL: clientConfig.authUrl,
  plugins: [magicLinkClient()],
});
`;
}

/**
 * The sign-in screens every site shares, as components with no framework in
 * them: `src/auth/*.tsx`. A page — Next's or TanStack's — renders one and
 * says where to go next, which is the only part that differs.
 */
export function authComponentFiles(
	options: TemplateOptions,
	app: SiteApp,
	clientDirective: boolean,
): GeneratedFile[] {
	const auth = `@${options.name}/auth`;
	const directive = clientDirective ? `'use client';\n\n` : '';

	const loginForm = `${directive}import { EmailSchema, MAGIC_LINK_MINUTES } from '${auth}/magic-link';
import { useRequestSignInLink } from '${auth}/client';
import { type FormEvent, useState } from 'react';
import { Button } from '~/components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card.tsx';
import { Input } from '~/components/ui/input.tsx';
import { Label } from '~/components/ui/label.tsx';

/** Where an emailed link brings the browser back: this site's own page. */
function callbackURL() {
  return \`\${window.location.origin}/signing-in\`;
}

/**
 * Ask for a sign-in link. There is no password and no separate sign-up:
 * opening the link signs in, and makes the account if there was none.
 */
export function LoginForm({ email: initial = '' }: { email?: string }) {
  const [email, setEmail] = useState(initial);
  const [invalid, setInvalid] = useState<string>();
  const { request, pending, result, reset } = useRequestSignInLink({
    callbackURL: typeof window === 'undefined' ? '/signing-in' : callbackURL(),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = EmailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message);
      return;
    }
    setInvalid(undefined);
    await request(parsed.data);
  }

  if (result?.sent) {
    return (
      <Card className="mx-auto w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We sent a sign-in link to {email}. It works once and expires in{' '}
            {MAGIC_LINK_MINUTES} minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={reset}>
            Use a different address
          </Button>
        </CardContent>
      </Card>
    );
  }

  const message = invalid ?? (result && !result.sent ? result.message : undefined);

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to ${app.title(options)}</CardTitle>
        <CardDescription>We'll email you a link to sign in.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={message ? true : undefined}
            />
            {message ? (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            ) : null}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Sending…' : 'Email me a link'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
`;

	const signingIn = `${directive}import { useSignInLinkResult } from '${auth}/client';
import { useEffect, useState } from 'react';
import { LoginForm } from './login-form.tsx';

/**
 * Where an emailed link lands. The auth server has already checked the link
 * and set the session cookie by the time the browser is here; what is left
 * is the \`?error=\` it adds when the link had expired, was used, or never
 * existed — and then a new link is the answer, to the address it was sent to.
 */
export function SigningIn({ onSignedIn }: { onSignedIn: () => void }) {
  // Read once the page is in a browser: there is no URL to read on a server.
  const [href, setHref] = useState<string>();
  useEffect(() => setHref(window.location.href), []);

  if (!href) return <p className="text-muted-foreground">Signing you in…</p>;
  return <Landing href={href} onSignedIn={onSignedIn} />;
}

function Landing({
  href,
  onSignedIn,
}: {
  href: string;
  onSignedIn: () => void;
}) {
  const landing = useSignInLinkResult(href);

  useEffect(() => {
    if (landing.signedIn) onSignedIn();
  }, [landing.signedIn, onSignedIn]);

  if (landing.signedIn) {
    return <p className="text-muted-foreground">Signing you in…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted-foreground">
        {landing.reason === 'expired'
          ? 'That link has expired or was already used. Send yourself a new one.'
          : "That link didn't sign you in. Send yourself a new one."}
      </p>
      <LoginForm email={landing.reason === 'expired' ? landing.email : undefined} />
    </div>
  );
}
`;

	const signOutButton = `${directive}import { useSignOut } from '${auth}/client';
import { Button } from '~/components/ui/button.tsx';

/** Sign out here and on the auth server. */
export function SignOutButton({ onSignedOut }: { onSignedOut?: () => void }) {
  const { signOut, pending } = useSignOut();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        await signOut();
        onSignedOut?.();
      }}
    >
      Sign out
    </Button>
  );
}
`;

	const files: GeneratedFile[] = [
		{ path: `${app.dir}/src/auth/login-form.tsx`, content: loginForm },
		{ path: `${app.dir}/src/auth/signing-in.tsx`, content: signingIn },
		{ path: `${app.dir}/src/auth/sign-out-button.tsx`, content: signOutButton },
	];

	if (app.key === 'web') {
		files.push({
			path: `${app.dir}/src/auth/account.tsx`,
			content: `${directive}import { useSession } from '${auth}/client';
import { SignOutButton } from './sign-out-button.tsx';

/** Who is signed in, or the way to sign in. */
export function Account() {
  const { data, isPending } = useSession();

  if (isPending) return null;
  if (!data) {
    return (
      <a className="text-sm font-medium underline" href="/login">
        Sign in
      </a>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <span className="text-sm text-muted-foreground">
        Signed in as {data.user.email}
      </span>
      <SignOutButton />
    </div>
  );
}
`,
		});
	}

	if (app.key === 'admin') {
		files.push(
			{
				path: `${app.dir}/src/auth/staff-gate.tsx`,
				content: `${directive}import { useSession } from '${auth}/client';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { api } from '~/api/index.ts';
import { SignOutButton } from './sign-out-button.tsx';

/**
 * The admin panel's door: signed in, and holding \`admin.access\`.
 *
 * Only what to draw. The API refuses every staff endpoint to someone without
 * the permission whatever this shows; asking it here is so that person sees
 * "no access" instead of a panel of failing requests.
 */
export function StaffGate({
  children,
  toLogin,
}: {
  children: ReactNode;
  toLogin: () => void;
}) {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const profile = useQuery({
    queryKey: ['profiles', 'me'],
    queryFn: () => api('GET /profiles/me'),
    enabled: signedIn,
  });

  useEffect(() => {
    if (!session.isPending && !signedIn) toLogin();
  }, [session.isPending, signedIn, toLogin]);

  if (session.isPending || !signedIn || profile.isPending) {
    return <p className="p-8 text-muted-foreground">Loading…</p>;
  }

  if (!profile.data?.permissions.includes('admin.access')) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-2xl font-semibold">No access</h1>
        <p className="text-muted-foreground">
          {session.data?.user.email} can't use the admin panel. Ask an admin to
          give you a role with admin access.
        </p>
        <SignOutButton onSignedOut={toLogin} />
      </main>
    );
  }

  return children;
}
`,
			},
			{
				path: `${app.dir}/src/admin/dashboard.tsx`,
				content: `${directive}import { useQuery } from '@tanstack/react-query';
import { api } from '~/api/index.ts';
import { SignOutButton } from '~/auth/sign-out-button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card.tsx';

/** The panel's first page: who has signed up. */
export function Dashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api('GET /admin/users'),
  });

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">${app.title(options)}</h1>
          <SignOutButton onSignedOut={onSignedOut} />
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Everyone who has signed in.</CardDescription>
          </CardHeader>
          <CardContent>
            {users.data ? (
              <ul className="divide-y">
                {users.data.users.map((user) => (
                  <li key={user.id} className="flex justify-between py-2">
                    <span>{user.name || '—'}</span>
                    <span className="text-muted-foreground">{user.email}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">Loading…</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
`,
			},
		);
	}

	return files;
}
