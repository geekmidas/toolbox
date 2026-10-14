---
'@geekmidas/cli': patch
---

`gkm build --production` bundles an app that never installed an optional peer it never loads. A @geekmidas package imports such a peer only on the path that needs it — `@aws-sdk/client-kms` for a `kms:` encryption key — but esbuild resolved that import anyway and failed the bundle (`Could not resolve "@aws-sdk/client-kms"`) for an app whose keys are all local. The optional peers of the app's @geekmidas packages that are not installed are now left external.
