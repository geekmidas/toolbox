---
'@geekmidas/telescope': patch
'@geekmidas/testkit': patch
---

Two more packages could not be installed

Found by the check added alongside them, which packs the tarballs and installs
each into an empty project.

**`@geekmidas/testkit` declared no dependencies at all** while importing
`EnvironmentParser`, `ConsoleLogger` and `serviceContext` as values from
`@geekmidas/envkit`, `@geekmidas/logger` and `@geekmidas/services`. All three
were optional peers. They are dependencies.

**`@geekmidas/telescope` could not be installed beside `@geekmidas/logger`.**
It required `pino@^9.0.0`; logger requires `pino@~10.0.0`. The two are
mutually exclusive, so any consumer with both got `ERESOLVE` and no install at
all. Widened to `^9.0.0 || ^10.0.0`, matching how the same package already
treats `pino-abstract-transport`. Its `@geekmidas/logger` peer also became a
dependency — `redact.ts` imports `DEFAULT_REDACT_PATHS` from it as a value,
from the root entry.
