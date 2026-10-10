---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
---

:sparkles: A `Credential` gets a test value from `test/fakes/<id>.ts`, and `gkm test` names one that has none

- **`fake.credential(value)`** (from `@geekmidas/constructs/credential`, and `/external-api` beside `fake.app`/`fake.image`), default-exported from `test/fakes/<id>.ts` — the folder an `ExternalApi`'s fake lives in — is the credential's `<ID>_CREDENTIALS` on the test stage and under `gkm dev --fake`. `fake.credential<typeof construct>(…)` checks it against the schema's input. A test stage set up fresh (CI's auto-setup) stores no third party's credentials, so a feature test resolving such a credential failed with a `ZodError` in the handler that first asked.
- **`gkm test` (and `--prepare`, and the Vitest global setup) refuses a credential with neither a fake nor a stored value** before any test runs: `CredentialHasNoTestValue`, naming the key and the fake file to create. A stored value is still used when there is no fake, and a fake wins over one, as an external API's does.
- **A credential's value survives the sniffed-env filter** in `gkm test`, since it is read inside the construct where no walk of the app sees it.
- Deployed stages never read a fake: a deploy still refuses a stage without the real key.
