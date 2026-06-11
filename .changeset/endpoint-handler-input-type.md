---
'@geekmidas/schema': patch
'@geekmidas/constructs': patch
---

feat(constructs): allow endpoint handlers to return the output schema's input type

Endpoint handlers previously had to return the output schema's *parsed* type
(`InferStandardSchema`). When an output schema coerces its value (e.g. a `Date`
serialized to an ISO `string`, or an applied default), that forced handlers to
pre-coerce values themselves even though the schema would do it on the way out.

A new `InferStandardSchemaInput` type is added to `@geekmidas/schema`, exposing a
Standard Schema's *input* type (`StandardSchemaV1.InferInput`). `Endpoint`'s
handler return type now uses it, so handlers may return the looser pre-coercion
input while consumers (`EndpointOutput` and the generated client) still see the
narrower parsed output type.
