---
"@geekmidas/audit": patch
"@geekmidas/auth": patch
"@geekmidas/cache": patch
"@geekmidas/cli": patch
"@geekmidas/client": patch
"@geekmidas/cloud": patch
"@geekmidas/constructs": patch
"@geekmidas/db": patch
"@geekmidas/emailkit": patch
"@geekmidas/envkit": patch
"@geekmidas/errors": patch
"@geekmidas/events": patch
"@geekmidas/logger": patch
"@geekmidas/rate-limit": patch
"@geekmidas/schema": patch
"@geekmidas/services": patch
"@geekmidas/storage": patch
"@geekmidas/studio": patch
"@geekmidas/telescope": patch
"@geekmidas/testkit": patch
"@geekmidas/ui": patch
---

Fix `package.json` exports so TypeScript declarations resolve correctly under NodeNext/Bundler module resolution. Each subpath export now nests `types` inside its `import`/`require` condition, pointing at the `.d.mts` and `.d.cts` files that `tsdown` actually emits (previously the exports referenced non-existent `.d.ts` files, causing type-resolution failures for consumers). Both ESM (`.mjs`) and CJS (`.cjs`) runtime entry points are preserved. Additionally, `@geekmidas/ui` had `import` paths pointing at `.js` files that were never emitted — those are corrected to `.mjs`.
