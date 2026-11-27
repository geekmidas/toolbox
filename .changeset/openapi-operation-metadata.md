---
'@geekmidas/constructs': minor
'@geekmidas/schema': minor
'@geekmidas/cli': minor
---

An endpoint has a summary, can be deprecated, carry `x-` extensions, and is grouped under described tags

`.summary()`, `.deprecated()` and `.extensions({ 'x-…': … })` on the builder
are written onto the endpoint's operation, and onto its JSDoc in the
generated client — `@deprecated` included. A key that is not `x-` throws
`NotAnExtension`.

A tag is a branch: `api.tag('payments', 'Taking money')` is a factory whose
endpoints carry the tag, and it chains like `.database()`. `.tag(name,
description?)` on a builder adds one more. The document lists each tag once,
in the order first named, with its description. `.tags([...])` now adds to
an endpoint's tags rather than replacing them.

A document with no title is titled after its surface's id rather than `API`,
and the generated server no longer hard-codes `API Documentation` over it.
