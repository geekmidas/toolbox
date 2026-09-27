---
'@geekmidas/cli': patch
'@geekmidas/studio': patch
'@geekmidas/telescope': patch
---

The build and test toolchain moves to its latest versions (tranche 2)

- **tsx 4.23, tsdown 0.23.** The CLI runs TypeScript through tsx, so its
  `tsx` dependency moves with it.
- **Vite 8, `@vitejs/plugin-react` 6** for the Studio and Telescope UIs, which
  ship inside those packages.
