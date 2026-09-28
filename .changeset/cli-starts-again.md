---
'@geekmidas/cli': patch
---

`gkm` starts again

Every command failed at startup with "Cannot add option '--region <region>'
to command 'init' due to conflicting flag '--region'": `init` registered
`--region` twice. CI now starts the built CLI and runs `--help` for every
command (`pnpm check:cli`), so a broken command registration fails the build
instead of shipping.
