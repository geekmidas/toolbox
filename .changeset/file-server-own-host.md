---
'@geekmidas/cli': minor
---

:boom: **A file server answers on its own name.** `new FileServer('Assets', …)`
is served on `assets.<domain>`, not `assets-server.<domain>`, and its
processors' origin on `assets-processors.<domain>`. One helper,
`fileServerLabel`, names every host a file server has: the `s3` provider's CDN
alias, certificate and DNS record, the compose edge's route, the local
`*.localhost` host and the processors' origin. The surface's node id and keys
(`AssetsServer`, `ASSETS_SERVER_URL`, `ASSETS_SERVER_ORIGIN_SECRET`) do not
change.

**Breaking for a deployed stage:** its next deploy requests a certificate for
the new name, moves the CDN alias and writes a new DNS record; links holding
the old host have to be updated. See "a file server answers on its own name"
in the upgrading guide.

A construct that answers on a file server's name, such as an app named
`assets` beside `FileServer('Assets')`, is refused when the workspace loads
with `FileServerHostTaken`.
