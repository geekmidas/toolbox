---
'@geekmidas/cli': patch
---

`gkm dev` starts again

Every `gkm dev` failed with `No owner to take a logger and an environment parser
from`. The generated entry reads its logger and env parser off the `RestApi` it
serves, and `gkm build` discovered that `RestApi` before generating, but dev
never did. Both now derive it the same way, and dev serves only the endpoints
built from its own `RestApi`, as build already did.

A `RestApi` declared without a `telescope` no longer fails every request once
Telescope is on: the entry falls back to the in-memory Telescope that
`telescope` config describes.
