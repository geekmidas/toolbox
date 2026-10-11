---
'@geekmidas/constructs': minor
'@geekmidas/cloud': minor
'@geekmidas/cli': patch
'@geekmidas/manifest': minor
---

`RandomPassword` — a password the platform generates, once per stage

```ts
import { RandomPassword } from '@geekmidas/constructs/random-password';

export const adminPassword = new RandomPassword('AdminPassword');

// a handler that `.dependsOn([adminPassword])`
services.adminPassword; // a string
```

It declares a `secret`, the kind an auth server's signing key already is, so
every stage handles it the way it handles that key. Its key is its name,
`ADMIN_PASSWORD`. The first deploy generates it and every later deploy reads
the same value back. A server stage keeps it in its secrets, and an AWS stage
keeps it in its Pulumi state. `gkm dev` and `gkm test` derive it, so nothing
has to be set and no fake is needed. In a feature test it is
`services.get('adminPassword')`.

By default it is 43 letters, digits, `-` and `_`. A system with password
rules of its own can ask for something else:

```ts
new RandomPassword('RouterPassword', { length: 24, symbols: '!@#$%' });
```

When there are symbols, at least one is always in the password. `symbols: ''`
draws letters and digits only. The server deploy, AWS, `gkm dev` and `gkm test`
all draw from the same alphabet, so a value that passes the rules locally
passes them deployed. A deployed stage keeps its password when the format
changes later. Local values of every secret, including an auth server's
signing secret, are drawn the new way, so they change once.

On AWS, every manifest `secret` is now generated on its first deploy instead of
failing synth until someone runs `sst secret set`. That includes an auth
server's signing secret. A value set with `sst secret set` still wins, so a
stage that already set one keeps it.
