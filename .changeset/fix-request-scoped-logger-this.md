---
'@geekmidas/services': patch
---

fix(services): bind `this` when invoking request-scoped logger methods

The request-scoped logger proxy re-resolved log methods at call time but
invoked them unbound. Pino's log methods read internal state off the
receiver (`this[Symbol(pino.msgPrefix)]`), so calling them without `this`
threw "Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')"
in production (pino), while dev/test console & spy loggers were unaffected.
The proxy now invokes the resolved method with the current request's logger
as `this`.
