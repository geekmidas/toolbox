---
'@geekmidas/cli': minor
---

:boom: Dokploy deploys are identified by namespace, project and stage, and never adopt a project they did not create

- **`deploy.namespace`.** A deploy's identity is `<namespace>/<project>` plus its stage. The namespace defaults to the kebab-cased workspace name; set it when two workspaces with one name deploy to one server. A chosen namespace is in the Dokploy project name (`acme-shop`), every application and service name (`production-acme-shop-api`) and the image path. The default adds nothing to the names a workspace was already deployed under.
- **Projects are claimed, not matched by name.** A project created by a deploy carries `gkm:<namespace>/<project>` in its description. Deploy uses the project its stage state names, then one with its name and its marker, then creates one. A project with the same name in any case and no marker (or another identity's) raises `ProjectNotOwned` and is never deployed into. Existing stages: the project id in state is trusted and the marker is written on the next deploy.
- **Images are `<registry>/<namespace>/<project>-<app>:<tag>`** (was `<registry>/<name>-<app>:<tag>`), and each app's ref and pushed digest are recorded in the stage state (`images`). Registry permissions scoped to the old repository names need the new path.
- **The registry is the one configured.** `deploy.dokploy.registry` is required (`RegistryNotConfigured`); Dokploy's registry is `deploy.dokploy.registryId`, else the one in the stage state, else the one Dokploy has for that registry's host and path (`RegistryAmbiguous` when several match, `RegistryNotFound` for a wrong id). It is never "the first registry Dokploy lists", and its id is kept in the stage state (`registryId`) rather than once per machine in `~/.gkm/credentials.json`.
