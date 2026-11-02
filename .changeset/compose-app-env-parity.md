---
'@geekmidas/cli': patch
---

:bug: `gkm compose` hands each app the env `gkm dev` does

`gkm dev`/`gkm exec` gave every app the stage's whole env, while `gkm compose`
wrote each env file from the keys its constructs declare and dropped the
stage's own secrets. One rule now decides an app's keys on every command
(`processEnvKeys`): what its constructs reach by their edges, plus every stage
secret no construct provides (a `get('STRIPE_KEY')` key), to every process —
never gkm's own keys for the stack. Under `gkm dev` an API's process also has
the keys of the workers it runs.

- `<ID>_URL` is the public URL on every command and stage: a backend reaches a
  sibling through the edge, not at `http://<app>:<port>` on the compose
  network.
- A site that runs a server (`variant: 'next'` or `'tanstack'`) gets a runtime
  env file under `gkm compose`: its edges' public URLs, its own address and the
  stage's own secrets. Its `NEXT_PUBLIC_*` values stay build args; a `static`
  site still reads nothing at runtime.
- `gkm dev` no longer hands every app the whole stage env through turbo: each
  app's own `gkm dev`/`gkm exec` resolves its keys, so code that reads a key
  without the edge finds it missing locally as it would on a stack.
- No internal origin is added to an auth server's trusted origins any more:
  a sibling calls it at its public address. A self-serving surface's server
  (an auth server) now continues the trace of a request from one of its
  trusted origins, as a generated API does, so an API's session check through
  the edge stays in the API's trace.
