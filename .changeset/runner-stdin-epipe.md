---
'@geekmidas/cli': patch
---

`gkm compose:server` no longer dies on a program that exits without reading its input

The runner behind `gkm compose:server` writes each command's input to its stdin. When the program exited before reading all of it, the write met a closed pipe, and the `EPIPE` it raised had no listener, so it was thrown as an uncaught exception instead of the run reporting the program's exit. The runner now ignores that error: the exit code already says how the program went.
