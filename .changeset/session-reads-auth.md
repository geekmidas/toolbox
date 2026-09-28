---
'@geekmidas/constructs': minor
---

`session({ auth })`: the surface's authenticator is where a session is read

`api.auth(auth)` declared an edge and nothing more — every project then
re-implemented reading the session with a hand-written service. Now a session
callback receives `auth`, the construct named in `.auth()`, bound to the request:

```ts
export const sessionRouter = router.session(async ({ auth }) => {
  const session = await auth.getSession();
  if (!session) throw new UnauthorizedError('No active session');
  return session;
});
```

Handlers still get whatever `.session()` returned. Only a `.session()` branch
asks the authenticator anything, so public routes pay nothing.

- `RestApi.auth()` takes an `Authenticator` — a construct with
  `verify(headers, envParser) → session | null` — and keeps it.
- `BetterAuth` implements it: `verify` asks the auth server for the session at
  the URL the `.auth()` edge injects, forwarding only `cookie` and
  `authorization`. A failing server throws `SessionCheckFailed` rather than
  reading as signed out. `AuthSession` is better-auth's session type.
- `auth.getSession()` on a surface with no `.auth()` throws `NoAuthenticator`.

Part 2 of #77.
