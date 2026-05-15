---
"@geekmidas/cli": patch
---

Fix `gkm openapi` workspace-mode generation when invoked from a directory other than the workspace root. The command now derives the workspace root from the loaded config, so subprocess-per-app generation works regardless of where the command is invoked from (previously the subprocess used CWD and silently no-op'd or failed with `spawn node ENOENT`).
