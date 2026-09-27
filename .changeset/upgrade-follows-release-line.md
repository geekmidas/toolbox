---
'@geekmidas/cli': patch
---

`gkm upgrade` follows the release line a project is on, and never goes backwards

It read npm's `latest` tag, which is 9.x while 10 is in prerelease: it could
not reach a 10 alpha, and on a project already on one it proposed 9.0.2 — a
downgrade — because it compared version text rather than versions. It then ran
`pnpm update --latest`, and never touched pnpm catalogs.

Now the target is the dist-tag of the line the project is on (`alpha` for
`10.0.0-alpha.x`), or `--tag`. A target behind what is installed is refused.
Without `--all` only `@geekmidas/cli` moves; with it, every `@geekmidas`
package moves to the one shared version, and third-party packages the project
lists are raised to the floor of the peer ranges that version declares. Ranges
keep their `^`/`~`/`>=`, pnpm `catalog:` entries are rewritten in place,
`workspace:` references and hand-written ranges are left alone, and one
install runs at the end.
