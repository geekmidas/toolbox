---
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
'@geekmidas/cloud': minor
---

:sparkles: A site's or mobile app's build gets its stage as `<prefix>STAGE`

Every deployed process is handed `STAGE`, but a bundle had no way to know which
stage it was built for. A client-side gate such as
`process.env.NEXT_PUBLIC_STAGE === 'production'` read `undefined` and was
silently false, so production-only analytics and error reporting never ran.

The stage is now inlined under the variant's public prefix: `NEXT_PUBLIC_STAGE`,
`VITE_STAGE` or `EXPO_PUBLIC_STAGE` (`publicStageKey`). Every path sets it: a
compose image build (declared as a Dockerfile `ARG`), an EAS build, the AWS
target, and `gkm dev`/`gkm test`, where it is the local or test stage. A stage
secret of the same name still wins, so a stage that already sets one keeps its
value. The value is fixed when the image is built, so an image promoted to
another stage keeps the stage it was built for.
