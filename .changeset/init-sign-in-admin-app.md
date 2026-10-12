---
'@geekmidas/cli': minor
---

`gkm init --template fullstack` scaffolds signing in, an admin panel, and an optional mobile app

The fullstack template now generates a product people sign in to, with magic links
working end to end:

- **`packages/auth`** (`@<name>/auth`) holds the sign-in logic every part shares.
  - `/server` has the Better Auth plugins the auth server is built from: the magic
    link sent through the mailer, a per-address limit on asking for one, and the
    store reviewers' links.
  - `/client` is headless React: an `AuthProvider` that takes whichever Better Auth
    client an app built, and the hooks `useSession`, `useRequestSignInLink`,
    `useSignInLinkResult` and `useSignOut`. The web site, the admin panel and the
    mobile app all use it, whether Next.js or TanStack Start.
  - `/magic-link` has the constants both sides must agree on.
- **The auth server** sends the link as a React Email template, through the `Email`
  construct (Mailpit locally).
- **The web site and an admin panel** share the framework you pick (`--web nextjs` or
  `--web tanstack-start`). Each has a sign-in page and a page for an opened link. The
  admin panel shows itself only to roles granting `admin.access`.
- **The API** has `memberRouter` and `staffRouter`, `GET /profiles/me`, a staff-only
  `GET /admin/users`, and feature tests that sign in through a real emailed link.
- **Roles and permissions** come as tables, seeds for Member and Super admin, and
  `scripts/grant-admin.ts` for the first admin.
- **Include a mobile app?** is a new question, `--mobile-app` / `--no-mobile-app`, and
  defaults to yes. Yes adds:
  - the Expo app, with its sign-in: continue, check your email, then the link brings
    the session back into the app;
  - the store-reviewer site: a reviewer's link is kept rather than mailed, and shown
    behind a `RandomPassword`.

The `expo` frontend choice is gone: a mobile app now sits beside the web site instead
of replacing it. The auth server's package is renamed `@<name>/auth-server`.
