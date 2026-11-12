---
'@geekmidas/cli': patch
'@geekmidas/manifest': patch
---

`gkm dev` and `gkm exec` now hand each app gkm's local CA and its site's image origins

Reconcile already resolved both, `NODE_EXTRA_CA_CERTS` and a site's
`NEXT_PUBLIC_GKM_IMAGE_ORIGINS`, but neither was among the keys an app's own
process is narrowed to, so scoping dropped them. A Next server component
fetching a sibling's `https://*.localhost` address failed with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, and `imageRemotePatterns()` returned `[]`, so
`next/image` refused every file-server image.

Every process now keeps the local CA, as it keeps the edge token. A site keeps
its image-origins key. That key is named in one place now, `imageOriginsFor` in
`@geekmidas/manifest`, which the dev environment, an app's keys and an image
build's arguments all read.
