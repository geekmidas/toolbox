---
'@geekmidas/telescope': minor
'@geekmidas/cli': minor
'@geekmidas/db': minor
---

:boom: Toolbox is headless: `@geekmidas/ui` and `@geekmidas/studio` are removed, Telescope serves JSON only, and `gkm dev` serves the declared database as a read-only JSON API

- **`@geekmidas/ui` and `@geekmidas/studio` are deprecated and no longer published.** Their last versions are `@geekmidas/ui@9.0.2` and `@geekmidas/studio@9.0.2` (`latest`), and `@geekmidas/ui@10.0.0-alpha.55` and `@geekmidas/studio@10.0.0-alpha.55` on `alpha`. Pin those to keep using them; nothing in toolbox depends on them any more. Studio's data layer lives on in `@geekmidas/db/introspect`; for components, run `npx shadcn@latest add` in your app.
- **Telescope has no dashboard.** The embedded React UI and its assets are gone, and `createUI` is renamed `createApi`: it serves the same JSON routes under `/api/*` (requests, exceptions, logs, stats, metrics) and nothing else, so the mount point's root and the old dashboard routes now 404. Recorders, storage adapters, the OTLP receiver and the WebSocket feed are unchanged. Replace `createUI(telescope)` with `createApi(telescope)`.
- **`@geekmidas/db/introspect`** (new): `listSchemas`, `introspectSchema`, `introspectTable`, a `DataBrowser` for cursor-paged, filtered and sorted rows, and `createIntrospectionHandler`, a fetch-style `(Request) => Promise<Response>` JSON API over them (`/schemas`, `/tables`, `/tables/:name`, `/tables/:name/rows`), read-only and with no HTTP framework dependency. A table with no configured cursor pages by its single-column primary key. Mistakes are named errors: `TableNotFound`, `ColumnNotFound`, `UnsupportedFilterOperator`, `InvalidCursor`.
- **`decodeCursor` throws `InvalidCursor`** (exported from `@geekmidas/db/pagination`, `/kysely/pagination` and `/objection/pagination`) instead of a plain `Error`; match on the class rather than the message.
- **`gkm dev` serves the database API at `/__gkm/db`** for the app's declared database, through the client its handlers use, and prints `db /__gkm/db` on the ready line. It replaces the Studio mount at `/__studio`. `gkm build` never includes it. The app needs `@geekmidas/db` installed, which a scaffold with a database already has.
- **The `studio` config option is removed** from `gkm.config.ts` and workspace app config, along with `StudioConfig`. Delete it; there is nothing to configure.
- **`gkm init` scaffolds no UI package.** Fullstack projects get shadcn/ui components written into the web app (`apps/web/src/components/ui/`, `components.json`, `src/lib/utils.ts`, the theme in its global stylesheet) instead of a `packages/ui` workspace package with Storybook. No template writes `src/config/studio.ts` or depends on `@geekmidas/studio`.
