# Brownfield Enhancement Architecture

## @geekmidas/cli Workspace-First Full-Stack Framework

**Version:** 1.0
**Status:** Draft
**Last Updated:** 2025-01-13

---

## Table of Contents

- [1. Current State](./1-current-state.md) - Existing CLI structure and capabilities
- [2. Target Architecture](./2-target-architecture.md) - Configuration model, components, file structure
- [3. Configuration Loading](./3-configuration.md) - defineWorkspace(), validation, normalization
- [4. Dev Server](./4-dev-server.md) - Turbo orchestration, dev services (db, cache, mail)
- [5. Docker](./5-docker.md) - Next.js Dockerfile, multi-app compose
- [6. Secrets](./6-secrets.md) - Encrypted secrets with AES-256-GCM
- [7. Client Generation](./7-client-generation.md) - Smart schema change detection
- [8. Init Command](./8-init-command.md) - gkm init templates and scaffolding
- [9. Integration](./9-integration.md) - Backwards compatibility, CLI reference, config example
- [10. Appendices](./10-appendices.md) - Migration, testing, risks, metrics

---

## Executive Summary

This document describes the architecture for enhancing the `@geekmidas/cli` package to support workspace-first, full-stack TypeScript development. The enhancement evolves the existing single-app CLI into a multi-app orchestration framework while maintaining 100% backwards compatibility with existing configurations.

### Key Architectural Decisions

1. **Wrapper Pattern**: `defineWorkspace()` wraps existing `GkmConfig`, single-app configs auto-wrapped
2. **Turbo Orchestration**: Leverage Turbo for multi-app dev, build, and prune operations
3. **Simplified Services**: db (postgres), cache (redis), mail (mailpit dev-only)
4. **Encrypted Secrets**: Committable `.enc.json` files with shared decryption key
5. **Next.js First**: First frontend framework support with standalone output builds

---

## Related Documents

- [PRD](../prd/index.md)
- [Project Brief](../brief.md)
- [Stories](../prd/stories/)
