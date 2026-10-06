---
'@geekmidas/cli': patch
'@geekmidas/db': patch
'@geekmidas/telescope': patch
'@geekmidas/testkit': patch
---

The build and test toolchain moves to its latest versions (tranche 2)

- **tsx 4.23, tsdown 0.23.** The CLI runs TypeScript through tsx, so its
  `tsx` dependency moves with it.
- **Vite 8, `@vitejs/plugin-react` 6** for the Studio and Telescope UIs, which
  ship inside those packages.
- **Vitest 5.** `@geekmidas/testkit` and `@geekmidas/db` require `vitest ~5.0.2`,
  so a project on an older Vitest needs to move with them. A fresh `gkm init`
  already ships Vitest 4+; the scaffold's pin follows with #43.
