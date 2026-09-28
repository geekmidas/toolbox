---
'@geekmidas/cli': patch
---

`gkm setup` no longer stores `NODE_ENV` in a stage's secrets

`gkm exec` injects secrets over the environment, so a stored
`NODE_ENV=development` made every `gkm exec -- next build` a development
build, and Next fails to prerender one (`Cannot read properties of null
(reading 'useContext')` on `/_global-error`). `gkm init` already left it out
for this reason; `gkm setup` — which a developer runs after cloning, and which
regenerates the stage — still wrote it, on both its single-app and its
fullstack path. The command decides `NODE_ENV`.

A stage generated before this keeps the key until it is removed from it.
