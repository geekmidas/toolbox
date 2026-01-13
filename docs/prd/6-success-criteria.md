# 6. Success Criteria

## 6.1 MVP Success Criteria

1. **Existing users can upgrade** — A single-app `gkm.config.ts` continues to work unchanged
2. **New workspace works end-to-end** — User can define 1 backend + 1 Next.js frontend, run `gkm dev`, edit backend endpoint, and see types update in frontend automatically
3. **Build produces deployable artifacts** — `gkm build` outputs production-ready builds for all apps
4. **One-command deploy** — `gkm deploy` successfully deploys entire workspace to Dokploy instance
5. **Selective deploy works** — `gkm deploy api` deploys only the specified app
6. **Dev/prod parity** — Same Dockerfiles work locally (via compose) and in Dokploy
7. **Documentation complete** — Workspace configuration, Dokploy setup, and deploy workflow fully documented
8. **No performance regression** — Single-app dev server startup time unchanged

## 6.2 Performance Targets

| Metric | Target |
|--------|--------|
| `gkm dev` cold start (single app) | <3 seconds |
| `gkm dev` cold start (2+ apps) | <5 seconds |
| Hot reload propagation | <500ms |
| Client regeneration | <2 seconds |

---
