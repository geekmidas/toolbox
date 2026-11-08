---
'@geekmidas/cli': patch
---

Each stage's images carry the stage in their tag

Every image a stage builds, pushes and pulls is now tagged `<tag>-<stage>`
(`stageTag`), not only a site's: `shop-api:<sha>-production` and
`shop-api:<sha>-staging`. Two builds of one commit are never the same image,
so when the deploy workflow's build matrix built two stages at one commit, both
pushed `shop-api:<sha>`, the last push owned it, and the other stage's deploy
failed with `RegistryUnreachable … unsupported manifest format` depending on
which build finished first. The compose and Dokploy targets name their images
by the same rule. A deploy given no `--tag` is tagged with its timestamp, and
its images `<timestamp>-<stage>` (they were `<stage>-<timestamp>`).

A pull pinned by `--digests-file` now asks the registry for each image by its
digest alone (`<image>@sha256:…`), so a tag moved since the push cannot fail
it. When the registry will not give a pinned digest while its tag answers, the
deploy stops with `PinnedImageMoved`, saying the tag resolves to a different
image than the pinned one, rather than `RegistryUnreachable` and a hint to
check the registry login.
