---
'@geekmidas/cli': patch
---

A scaffolded `CLAUDE.md` imports `AGENTS.md` instead of linking to it

It pointed at the conventions with `[AGENTS.md](./AGENTS.md)`, and Claude Code
follows no links: it loaded the pointer and none of what it pointed at. It now
reads `@AGENTS.md`, which Claude Code loads into context with the file. The
conventions still live only in `AGENTS.md`.
