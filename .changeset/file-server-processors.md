---
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
'@geekmidas/cli': minor
'@geekmidas/cloud': minor
---

File server processors: derivatives of open objects, made on read

`assets.process('/i/:width/*').params(schema).handle(…)` puts a handler behind
one path pattern of a file server — a thumbnail, a page of a PDF — made when it
is read, so every object already in the bucket is covered. The parameters'
schema is the allowlist: anything it refuses is a short-cached `400` and the
handler never runs. Only open paths are processed. A result marked
`cache: 'immutable'` is kept in the bucket under `.gkm-derived/` and answered
from there next time; `services.assets.processedUrl(processor, params, key)`
addresses it.

- **Manifest:** `FileServerDeclaration.processors`, nested — discovery puts
  each one there with its source as its handler, and a build replaces it with
  the generated one.
- **Compose:** a file server's processors run in a container of their own
  (`<fileserver>-processors`), built from the app holding them, with any
  `.native([...])` packages installed for linux. Behind the stack's MinIO, the
  file server's host sends their patterns there and every other path to the
  bucket (`EdgeRoute.handlers`, rendered for Caddy and Traefik). With the
  bucket on S3, the CDN sends each pattern to the container's own host,
  adding a secret header the edge requires (`EdgeRoute.requireHeader`,
  `EdgeRoute.prefixes`); the deploy keeps the secret as
  `<FILESERVER>_SERVER_ORIGIN_SECRET`.
- **CDN (`s3` provider):** a custom origin per file server with processors,
  and a behaviour per pattern ahead of the immutable ones, keyed on the path
  alone and not re-compressed.
- **SST:** each processor is a Lambda behind an IAM-auth function URL, routed
  through the file server's router with origin access control.
- **Build:** `gkm build --production` writes and bundles each processor unit
  beside the server; `gkm docker` writes its Dockerfile.

Two constructs routed to one host still fail with `EdgeHostTaken`; a route
that sends paths elsewhere and also restricts who it answers fails with
`EdgeRouteConflict`.
