---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
'@geekmidas/cloud': patch
'@geekmidas/envkit': patch
'@geekmidas/testkit': patch
---

`ExternalApi` for third-party HTTP APIs, `<ID>_CREDENTIALS`, and `faker` and `signIn()` in feature tests

- **`ExternalApi`** (`@geekmidas/constructs/external-api`) declares an API
  somebody else runs: a `url`, one string or one per stage name with a
  `default`, a `credentials` schema, and the `client` a handler is given. It
  provides `<ID>_URL` and `<ID>_CREDENTIALS` (kind `external-api`).
- **Its fake lives at `test/fakes/<id>.ts`**, never in the construct, so it
  cannot reach a deployed bundle. The file default-exports
  `fake.app(handler, { credentials })` or
  `fake.image('stripe/stripe-mock', { port, credentials })`.
  - **Feature tests** serve an app fake in-process through MSW.
  - **`gkm dev`** serves it on an allocated port.
  - **An image fake** runs as a container on an allocated host port.
  - **Local and test stages** get the fake's URL and credentials.
  - **No fake:** an external API without one fails with `NoFake`.
- **Deploying** resolves the URL for the stage (`NoUrlForStage` when it has
  none) and the credentials from the stage's secrets, on Dokploy and on AWS.
- **`Credential` provides `<ID>_CREDENTIALS`**, renamed from `<ID>_CREDENTIAL`.
- **Dokploy now resolves credentials.** A stage missing `<ID>_CREDENTIALS` for
  a `Credential` or an `ExternalApi` fails `gkm deploy` with
  `MissingSuppliedSecret`, naming the `gkm secrets:set` command. Before this,
  Dokploy never resolved a credential at all.
- **Feature tests get `faker`**, testkit's faker seeded from the test's name.
  `browser.signIn()` with no address signs in as a new, unique user. testkit's
  `faker` regains `seed()`, which the spread had dropped.

**Moving an existing app:** rename every `<ID>_CREDENTIAL` secret to
`<ID>_CREDENTIALS` and set it on each deployed stage:
`gkm secrets:set STRIPE_CREDENTIALS '{…}' --stage production`.
