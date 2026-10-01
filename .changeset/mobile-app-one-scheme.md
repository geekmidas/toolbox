---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
---

`MobileApp`: one scheme for every stage, and the app adds `expo()` itself

- **One scheme.** A mobile app's scheme is the project's name (`shop`), or the
  one its construct gives, on every stage: local, test and deployed. It was
  suffixed locally (`shop-dev`). `appScheme` is gone from `@geekmidas/manifest`,
  and `schemeBase` is the scheme.
- **`@geekmidas/constructs` no longer depends on `@better-auth/expo`.** The
  auth construct imported it as an optional peer, and pnpm gives
  `@geekmidas/constructs` a separate copy for every workspace package that
  resolves that peer differently. A construct from one copy is not an instance
  of the other, so the test harness found none of an app's databases and every
  feature test failed with `UnknownFactory`.
- **The app adds `expo()` to its auth server's plugins.** When the graph says a
  mobile app calls the auth server (a scheme among its derived trusted
  origins) and the plugin is missing, the server refuses to start with
  `ExpoPluginRequired`, naming the scheme. It finds the plugin by its `id`
  without importing the package. An origin the app trusts by hand is not
  checked. `gkm init` with Expo writes `expo()` into `constructs/auth.ts`.

**Moving an existing app:**
- add `import { expo } from '@better-auth/expo'` and `options: { plugins: [expo()] }`
  to the auth construct;
- install `@better-auth/expo` where that file resolves its imports;
- rebuild the app with the scheme without its stage suffix.
