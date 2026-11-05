---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/envkit': patch
'@geekmidas/cloud': patch
'@geekmidas/cli': patch
---

A bucket's connection and a file server's public address have new keys, so `_URL` always means an address a browser opens:

| | Before | Now |
|---|---|---|
| a bucket's connection (`s3://<bucket>?region=…`) | `<ID>_URL` | `<ID>_CONNECTION_STRING` |
| a file server's public address (`https://<id>.<domain>`) | `<ID>_SERVER_URL` | `<ID>_URL` |

`new FileServer('Assets')` now provides `ASSETS_CONNECTION_STRING` and `ASSETS_URL`, and a Vite site's bundle gets `VITE_ASSETS_URL`. `DATABASE_URL`, a cache's `<ID>_URL` and `MAIL_URL` keep their names.

The constructs read the new keys, and gkm writes them. A deployed stage still holds the old ones. The first deploy after upgrading moves them in its secrets: the bucket's `<ID>_URL` to `<ID>_CONNECTION_STRING`, then the file server's `<ID>_SERVER_URL` to `<ID>_URL`. A provider reuses its bucket's access key, and a key you set by hand on an `external` stage moves the same way. A dry run prints the moves and writes nothing. Only code that reads the raw keys instead of `services.<id>` needs to change.
