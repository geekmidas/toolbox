---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
'@geekmidas/cloud': patch
---

`MobileApp`: an Expo app declared as a construct

```ts
// constructs/app.ts
export const app = new MobileApp('App', { path: 'apps/app' })
  .dependsOn([api, auth]);
```

Like a `StaticSite`, its `.dependsOn()` is the single fact everything a mobile
app otherwise writes down by hand is derived from:

- **A scheme per stage:** the project's name deployed (`beetlefit`), suffixed
  locally (`beetlefit-dev`), so a development build and the store build on one
  phone never answer each other's links. It arrives as `APP_SCHEME`.
- **URLs a phone can reach:** `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_URL`.
  Locally they're each server's own port, which the app points at the LAN
  address Metro served it from on a phone, or `10.0.2.2` on the Android
  emulator, instead of an edge hostname that only resolves on this machine.
- **Trusted origins:** the scheme, in every surface it depends on. Locally that
  also covers the `exp://` origins Expo Go sends from, for this machine's exact
  LAN address and `localhost`, never a subnet.
- **Better Auth's Expo plugin:** `BetterAuth` adds `expo()` itself when a
  mobile app depends on it. `@better-auth/expo` is an optional peer, and
  `ExpoPluginMissing` says to install it.
- **Sign-in links a phone can open:** locally, a magic link the app asked for
  (its `callbackURL` is the scheme) is built on the auth server's LAN address,
  `AUTH_DEVICE_URL`. A browser's link is left alone.
- **Deployed:** Dokploy and AWS trust the bare scheme. Neither builds the app;
  EAS and the stores do.

`gkm init` with Expo declares the app in `constructs/app.ts` and installs
`@better-auth/expo` at the root. Its `app.config.ts` parses `APP_SCHEME` and
both URLs into `extra.config`, which `config.ts` reads at runtime. `eas.json`
no longer hard-codes local URLs. `gkm dev` lists the app with its scheme and
the address devices reach.

`@geekmidas/manifest` adds the `mobile-app` declaration kind, and
`schemeBase`, `appScheme`, `mobileOrigins` and `isWebOrigin` for the rules all
three targets share.

See `docs/design/mobile-app.md`.
