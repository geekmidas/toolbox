---
'@geekmidas/cli': patch
---

:bug: A config that reads the environment gives the deploy the same settings at every step

`gkm compose` and `gkm deploy` loaded `gkm.config.ts` in their own process,
then `deploy()` loaded it again in its sandbox, whose environment is an
allowlist. A config reading `process.env.DOMAIN` had a domain for the first
load and none for the deploy, which stopped with `FileServerCdnNeedsDomain`.
Both commands now hand the config they loaded to the run, as
`deploy({ config })`, and every step reads that one. The constructs are still
discovered, and the apps built, in the sandbox. A `deploy()` called with no
`config` loads it in its sandbox as before.
