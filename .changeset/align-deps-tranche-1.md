---
'@geekmidas/telescope': patch
'@geekmidas/cli': patch
'@geekmidas/schema': patch
'@geekmidas/testkit': patch
---

Every package now agrees on every dependency version

One hundred dependencies were realigned so that each has a single range per
field across the repo. Thirty had disagreed with themselves — `hono` carried
four different peer ranges, `@types/pg` four dev ranges, `@middy/core` four of
each — which meant two packages could install two copies of the same library
and behave differently for reasons nobody had chosen.

Twenty-three were major bumps, and three of them broke something real:

**OpenTelemetry 1.x → 2.x** removed `addSpanProcessor` and
`BasicTracerProvider.register()`. Processors are constructor-only now, because a
provider whose pipeline could be re-plumbed after it had begun producing spans
was never safe. `NodeTracerProvider.register()` survives and is still the right
call where the async-hooks context manager is wanted.

**Zod 4.1 → 4.6** exposed a generator bug rather than causing one. A schema that
*is* a registered schema now converts to a bare `$ref` where it used to be
inlined, and `OpenApiTsGenerator` turned that into `export type User = User` — a
circular alias that is not a type. The def it points at was already being
emitted; the generator now leaves the declaration to it. 4.6 also collapses a
union of primitives to a `type` array instead of `anyOf`, which is the 2020-12
spelling this project already emits.

**better-auth 1.7** removed `runAdapterTest`, the conformance harness
`memoryAdapter` was tested with. There is nothing to repair — the API is gone —
so that suite is skipped with the gap recorded rather than deleted, because a
deleted file would not say that `memoryAdapter` now has no test.

Not included: the build and test toolchain — TypeScript, Vitest, Vite,
Storybook — and `expo-secure-store`, whose version tracks an Expo SDK release
train. Those replace how every package compiles and runs, and belong where a
failure has one candidate cause instead of twenty-eight.
