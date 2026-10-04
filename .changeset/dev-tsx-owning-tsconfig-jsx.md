---
'@geekmidas/cli': patch
---

`gkm dev` compiles a construct's `.tsx` with its own tsconfig's JSX settings

`gkm dev` runs each app with tsx from the app's directory, and tsx applies that
tsconfig only to the files its `include` covers. An email template in the
workspace's `constructs/` was outside it, so tsx compiled it with esbuild's
defaults — the classic runtime — and a template that, under the root
tsconfig's `"jsx": "react-jsx"`, imports no React threw `React is not defined`
at render. `gkm test` compiles it with the root tsconfig, where it rendered.

A hook now sits between tsx and each `.tsx`/`.jsx` file and appends the JSX
settings of the tsconfig that owns it — the nearest one above it, as Vitest
chooses — as esbuild pragmas, so each file is compiled the way its own tsconfig
says, under `gkm dev` and `gkm test` alike. It is installed by `bin/gkm.mjs`
and by every process that runs app code through tsx (`gkm dev`'s app and server
processes, the env sniffer). Pointing tsx at the root tsconfig instead would
have broken an app that sets its own `jsx` or `jsxImportSource`, for the same
reason one tsconfig per process was wrong for path aliases. A file with its own
JSX pragma, or whose tsconfig sets `preserve`, is left as it is.
