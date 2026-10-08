---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
---

Stage names are typed from the declared stages

A stage name written outside `gkm.config.ts` was a bare `string`, so a typo
was never caught: an `ExternalApi` keyed `prodution` silently fell back to
`default`, and a seed's `stage === 'prodution'` branch silently never ran.

`gkm dev`, `gkm build` and `gkm test --prepare` now write `.gkm/stages.d.ts`
from the loaded workspace:

```ts
declare module '@geekmidas/constructs' {
  interface Stages { local: 'dev'; deployed: 'staging' | 'prod' }
}
```

`@geekmidas/constructs` exports the `Stages` interface and the types read
from it: `LocalStage`, `DeployedStage`, `TestStage` (`'test'`) and `AnyStage`.
Without the file, before the first run, each of them is `string`, so nothing
fails to compile for want of it.

What they type:

- `ExternalApi`'s `url` map (`ExternalApiUrl`): keys are the local and
  deployed stages plus `default`.
- A seed's second argument, `SeedContext` (now exported from
  `@geekmidas/constructs`): `stage` is `AnyStage`.
- The test manifest's `stage`, `TestStage`.

TypeScript never matches a dot folder with a wildcard, so the tsconfig names
the file: `gkm init` adds `.gkm/stages.d.ts` to each API's (and the root's)
`include`. An existing project adds it by hand. Nothing changes at runtime.
