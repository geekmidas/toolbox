---
'@geekmidas/constructs': patch
'@geekmidas/envkit': patch
---

No longer depend on `lodash.pick` and `lodash.set`, which are affected by GHSA-p6mc-m468-83gw and have no fixed release. Native code does the same work, and constructs no longer bundles either module into its dist.
