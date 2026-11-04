---
'@geekmidas/cli': patch
---

:bug: Adding processors to a file server whose CDN already exists updates its distribution

An update replaces each CloudFront origin and behaviour whole, and CloudFront
refuses one missing a field it fills in itself on create: the deploy that
added a file server's first processor stopped with `IllegalUpdate: The
'OriginCustomHeaders' field is missing`, then `The parameter SmoothStreaming
flag is missing`. Every origin and behaviour now spells those fields out at
CloudFront's own defaults, so an existing distribution is still seen as
holding what it should.
