# Mobile apps on a deployed stage

A `MobileApp` is built by EAS and shipped by the stores, so nothing in a
deploy runs it. What it is built with, though, is the stage's: the URLs of the
API and auth server it calls, and its URL scheme. gkm derives those from the
workspace the same way it does for a site, so a store build talks to the same
servers the stage was deployed with.

```ts
// constructs/mobile.ts
import { MobileApp } from '@geekmidas/constructs/mobile-app';

export const app = new MobileApp('App', { path: 'apps/app' }).dependsOn([
  api,
  auth,
]);
```

Locally, `gkm dev` and `gkm exec` hand the app its values. A store build runs
on EAS's machines, outside gkm, so a deployed stage's values have to reach EAS.

## What a stage's build reads

For a deployed compose stage, the app's build reads:

- its scheme, under the key its `app.config.ts` reads (`APP_SCHEME`);
- each edge's public value under `EXPO_PUBLIC_`: `EXPO_PUBLIC_API_URL`,
  `EXPO_PUBLIC_AUTH_URL`, as the stage's public addresses;
- every stage secret already named `EXPO_PUBLIC_…`, such as
  `EXPO_PUBLIC_STORE_URL` set with `gkm secrets:set`.

Nothing else. A server key never reaches a mobile build, and a deployed stage
has no Mailpit inbox.

## How each stage ships

Each deployed stage reads an EAS environment, listens on an EAS Update
channel, and submits Android builds to a Play track:

| Stage | EAS environment | Channel | Play track | Release status |
| --- | --- | --- | --- | --- |
| the protected one (`stages.protected`) | `production` | the stage's name | `production` | `draft` |
| every other deployed stage | `preview` | the stage's name | `internal` | `draft` |

A `draft` release waits in Play Console until someone releases it. A stage
that ships differently says so on the `MobileApp`:

```ts
new MobileApp('App', {
  path: 'apps/app',
  stages: {
    beta: { android: { track: 'alpha', releaseStatus: 'completed' } },
  },
});
```

A stage named there that `stages.deployed` doesn't list is refused
(`MobileAppStageUndeclared`). EAS's free plan only has the `production`,
`preview` and `development` environments.

## `gkm eas:sync`

```bash
gkm eas:sync --stage prod --profile acme-prod
```

Run from the app's directory, or anywhere in a workspace with one mobile app
(`--app <app>` picks one of several). It:

1. writes the stage's profiles into the app's `eas.json`: `build.<stage>` gets
   its `environment` and `channel`, and `submit.<stage>.android` its `track`
   and `releaseStatus`. Every other field is kept, so `autoIncrement`,
   `corepack` or an iOS `ascAppId` stay as written;
2. sets each value the build reads in the stage's EAS environment, with
   `eas env:set`, as `plaintext`: a bundle inlines them, so none is secret.

`--dry-run` prints the profiles and values and writes nothing. It needs the
app's `eas`, installed in the app (`pnpm add -D eas-cli`) or globally, and an
EAS login: `eas login` here, `EXPO_TOKEN` in CI. The stage's secrets are read
the way a deploy reads them; `--profile` names the AWS profile for an S3, SSM
or Secrets Manager store.

Then build with the stage's profile:

```bash
eas build --profile prod --platform all
```

## `gkm exec --stage` for a mobile app

From the app's directory, `gkm exec --stage prod -- <command>` runs the command
with the same values `eas:sync` writes, which is enough for a local store
build:

```bash
cd apps/app
gkm exec --stage prod -- eas build --profile prod --local
```

It needs no SSH: nothing a mobile app reads is on the stage's server network.
