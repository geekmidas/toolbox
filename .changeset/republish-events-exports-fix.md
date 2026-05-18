---
"@geekmidas/events": patch
---

Republish with the `package.json` exports fix that nests `types` inside each `import`/`require` condition and points at the `.d.mts`/`.d.cts` files that `tsdown` actually emits. The previous version (1.1.3) was tagged but failed to publish to npm; this bump retries publication so consumers can resolve types correctly under NodeNext/Bundler module resolution.
