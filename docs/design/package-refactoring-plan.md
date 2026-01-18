# Package Refactoring Plan: Constructs and Schema

**Status**: Planning
**Created**: 2025-10-13
**Target Completion**: TBD

## Executive Summary

This document outlines the plan to refactor the `@geekmidas/toolbox` monorepo by:

1. **Extracting Constructs**: Move construct-related code from `@geekmidas/api` to a new `@geekmidas/constructs` package
2. **Extracting Schema Utilities**: Move schema validation utilities from `@geekmidas/api` to `@geekmidas/schema`

These changes will improve:
- Package modularity and separation of concerns
- Reusability across different contexts
- Dependency management and tree-shaking
- Package size and performance

## Background

### Current Architecture Issues

#### 1. @geekmidas/api is Too Large

The `@geekmidas/api` package currently contains:
- HTTP endpoint builders
- Cloud function builders
- Scheduled task builders
- Event subscriber builders
- Service discovery system
- Rate limiting
- Session management
- Authorization
- Adapters (AWS Lambda, Hono, etc.)
- **Construct abstractions** ← Should be separate
- **Schema validation utilities** ← Should be separate

This creates several problems:
- Large bundle size even for simple use cases
- Unclear boundaries between concerns
- Difficult to test in isolation
- Hard to version independently

#### 2. Schema Utilities are Buried

Schema validation utilities are in `@geekmidas/api/constructs/helpers`:
- `convertStandardSchemaToJsonSchema`
- `convertSchemaWithComponents`
- Schema composition utilities

These utilities:
- Are useful beyond just API constructs
- Should be available to other packages
- Are tightly coupled with API package
- Can't be versioned independently

#### 3. Construct Abstraction is Generic

Constructs (`Endpoint`, `Function`, `Cron`, `Subscriber`) are generic abstractions that:
- Could be used outside of HTTP/API context
- Have minimal dependencies on HTTP-specific code
- Should be composable building blocks
- Are conceptually separate from adapters

## Goals

### Primary Goals

1. **Separation of Concerns**: Clear boundaries between constructs, API, and schema utilities
2. **Modularity**: Allow packages to be used independently
3. **Reusability**: Enable constructs to be used in non-HTTP contexts
4. **Smaller Bundles**: Reduce package size by splitting concerns
5. **Better Testing**: Isolate concerns for easier testing

### Non-Goals

1. **Breaking Changes for Users**: Maintain backward compatibility via re-exports
2. **Performance Regression**: No performance degradation
3. **Feature Additions**: Focus on refactoring, not new features (during refactoring phase)

## Proposed Package Structure

### Before

```
@geekmidas/toolbox
├── packages/api
│   ├── src/constructs/          # Construct abstractions
│   │   ├── Endpoint.ts
│   │   ├── Function.ts
│   │   ├── Cron.ts
│   │   ├── Subscriber.ts
│   │   ├── EndpointBuilder.ts
│   │   ├── FunctionBuilder.ts
│   │   ├── helpers.ts           # Schema utilities
│   │   └── openapi.ts
│   ├── src/adaptors/            # Runtime adapters
│   ├── src/services.ts          # Service discovery
│   └── src/rate-limit.ts        # Rate limiting
├── packages/schema              # Exists but minimal
│   └── src/index.ts             # Type utilities only
└── packages/cli                 # CLI tools
```

### After

```
@geekmidas/toolbox
├── packages/constructs          # NEW: Core construct abstractions
│   ├── src/Construct.ts
│   ├── src/Endpoint.ts
│   ├── src/Function.ts
│   ├── src/Cron.ts
│   ├── src/Subscriber.ts
│   ├── src/builders/
│   │   ├── EndpointBuilder.ts
│   │   ├── FunctionBuilder.ts
│   │   └── BaseFunctionBuilder.ts
│   └── src/types.ts
├── packages/schema              # ENHANCED: Schema validation utilities
│   ├── src/types.ts             # Type utilities (existing)
│   ├── src/conversion.ts        # NEW: Schema conversion utilities
│   ├── src/composition.ts       # NEW: Schema composition
│   └── src/openapi.ts           # NEW: OpenAPI utilities
├── packages/api                 # REFACTORED: HTTP/API specific
│   ├── src/server/              # Server-side utilities
│   │   └── index.ts             # Re-exports EndpointBuilder as 'e'
│   ├── src/function/            # Function builder
│   │   └── index.ts             # Re-exports FunctionBuilder as 'f'
│   ├── src/cron/                # Cron builder
│   │   └── index.ts             # Re-exports CronBuilder as 'cron'
│   ├── src/subscriber/          # Subscriber builder
│   │   └── index.ts             # Re-exports SubscriberBuilder as 's'
│   ├── src/adaptors/            # Runtime adapters (stays)
│   ├── src/services.ts          # Service discovery (stays)
│   └── src/rate-limit.ts        # Rate limiting (stays)
└── packages/cli                 # Updated imports
```

## Migration Strategy

### Phase 1: Create New Packages (No Breaking Changes)

#### Step 1.1: Create @geekmidas/constructs

```bash
mkdir -p packages/constructs/src
```

**Move the following from `@geekmidas/api/src/constructs/`**:
- `Construct.ts` → `packages/constructs/src/Construct.ts`
- `Endpoint.ts` → `packages/constructs/src/Endpoint.ts`
- `Function.ts` → `packages/constructs/src/Function.ts`
- `Cron.ts` → `packages/constructs/src/Cron.ts`
- `Subscriber.ts` → `packages/constructs/src/Subscriber.ts`
- `EndpointBuilder.ts` → `packages/constructs/src/builders/EndpointBuilder.ts`
- `FunctionBuilder.ts` → `packages/constructs/src/builders/FunctionBuilder.ts`
- `BaseFunctionBuilder.ts` → `packages/constructs/src/builders/BaseFunctionBuilder.ts`
- `EndpointFactory.ts` → `packages/constructs/src/builders/EndpointFactory.ts`
- `types.ts` → `packages/constructs/src/types.ts`
- `publisher.ts` → `packages/constructs/src/publisher.ts`

**Package Configuration**:

```json
{
  "name": "@geekmidas/constructs",
  "version": "0.1.0",
  "exports": {
    ".": "./src/index.ts",
    "./endpoint": "./src/Endpoint.ts",
    "./function": "./src/Function.ts",
    "./cron": "./src/Cron.ts",
    "./subscriber": "./src/Subscriber.ts",
    "./builders": "./src/builders/index.ts",
    "./types": "./src/types.ts"
  },
  "dependencies": {
    "@geekmidas/schema": "workspace:*",
    "@geekmidas/logger": "workspace:*",
    "@geekmidas/events": "workspace:*",
    "@standard-schema/spec": "^1.0.0",
    "lodash.pick": "^4.4.0",
    "lodash.set": "^4.3.2",
    "lodash.uniqby": "^4.7.0",
    "openapi-types": "^12.1.3"
  }
}
```

#### Step 1.2: Enhance @geekmidas/schema

**Move the following from `@geekmidas/api/src/constructs/`**:
- `helpers.ts` (schema conversion functions) → `packages/schema/src/conversion.ts`
- OpenAPI-related utilities from `openapi.ts` → `packages/schema/src/openapi.ts`

**Updated Package Configuration**:

```json
{
  "name": "@geekmidas/schema",
  "version": "0.2.0",
  "exports": {
    ".": "./src/index.ts",
    "./conversion": "./src/conversion.ts",
    "./openapi": "./src/openapi.ts"
  },
  "dependencies": {
    "@standard-schema/spec": "^1.0.0",
    "openapi-types": "^12.1.3"
  }
}
```

**New Files**:

`packages/schema/src/conversion.ts`:
```typescript
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Converts a StandardSchema to JSON Schema format
 */
export async function convertStandardSchemaToJsonSchema(
  schema: StandardSchemaV1
): Promise<JSONSchema> {
  // Implementation moved from api package
}

/**
 * Converts a schema with component collection for OpenAPI
 */
export async function convertSchemaWithComponents(
  schema: StandardSchemaV1,
  collector?: ComponentCollector
): Promise<JSONSchemaOrRef> {
  // Implementation moved from api package
}
```

`packages/schema/src/openapi.ts`:
```typescript
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { OpenAPIV3_1 } from 'openapi-types';

export interface ComponentCollector {
  // Interface moved from api package
}

export interface OpenApiSchemaOptions {
  // Interface moved from api package
}

/**
 * Builds OpenAPI schema from constructs
 */
export async function buildOpenApiSchema(
  endpoints: any[],
  options?: OpenApiSchemaOptions
): Promise<OpenAPIV3_1.Document> {
  // Implementation moved from api package
}
```

#### Step 1.3: Update @geekmidas/api with Re-exports

Keep backward compatibility by re-exporting from new packages:

`packages/api/src/constructs/index.ts`:
```typescript
/**
 * @deprecated Import from '@geekmidas/constructs' instead
 */
export {
  Endpoint,
  Function,
  Cron,
  Subscriber,
  type Construct,
  ConstructType,
} from '@geekmidas/constructs';

/**
 * @deprecated Import from '@geekmidas/constructs/builders' instead
 */
export {
  EndpointBuilder,
  FunctionBuilder,
  EndpointFactory,
} from '@geekmidas/constructs/builders';

/**
 * @deprecated Import from '@geekmidas/schema/conversion' instead
 */
export {
  convertStandardSchemaToJsonSchema,
  convertSchemaWithComponents,
} from '@geekmidas/schema/conversion';
```

`packages/api/src/server.ts`:
```typescript
import { EndpointFactory } from '@geekmidas/constructs/builders';

// Export as 'e' for builder pattern (no breaking change)
export const e = new EndpointFactory([]);

// Re-export types
export type { Endpoint, EndpointContext, EndpointHandler } from '@geekmidas/constructs';
```

### Phase 2: Update Dependent Packages

#### Update @geekmidas/cli

`packages/cli/src/build/index.ts`:
```typescript
// Before
import type { Cron, Function, Subscriber } from '@geekmidas/api/constructs';
import type { Endpoint } from '@geekmidas/api/server';

// After
import type { Endpoint, Cron, Function, Subscriber } from '@geekmidas/constructs';
```

`packages/cli/src/generators/Generator.ts`:
```typescript
// Before
import type { Construct } from '@geekmidas/api/constructs';

// After
import type { Construct } from '@geekmidas/constructs';
```

#### Update Tests

Update all test files to import from new packages:
- `packages/api/src/__tests__/**/*.spec.ts`
- `packages/cli/src/__tests__/**/*.spec.ts`

### Phase 3: Documentation and Communication

#### Update Documentation

1. **Add Migration Guide** (`docs/migrations/constructs-schema-split.md`):
```markdown
# Migration Guide: Constructs and Schema Package Split

## Overview

In version X.X.X, we've split constructs and schema utilities into separate packages.

## What Changed

- Constructs moved: `@geekmidas/api/constructs` → `@geekmidas/constructs`
- Schema utilities moved: `@geekmidas/api/constructs/helpers` → `@geekmidas/schema`

## Migration Steps

### For @geekmidas/constructs

```diff
- import { Endpoint, Function } from '@geekmidas/api/constructs';
+ import { Endpoint, Function } from '@geekmidas/constructs';

- import { EndpointBuilder } from '@geekmidas/api/constructs';
+ import { EndpointBuilder } from '@geekmidas/constructs/builders';
```

### For @geekmidas/schema

```diff
- import { convertStandardSchemaToJsonSchema } from '@geekmidas/api/constructs/helpers';
+ import { convertStandardSchemaToJsonSchema } from '@geekmidas/schema/conversion';
```

## Backward Compatibility

For backward compatibility, old imports still work but are deprecated:

```typescript
// Still works, but deprecated
import { Endpoint } from '@geekmidas/api/constructs';
```

## Timeline

- **v1.0**: New packages available, old imports work
- **v2.0**: Old imports show deprecation warnings
- **v3.0**: Old imports removed (breaking change)
```

2. **Update CLAUDE.md** to reflect new package structure

3. **Update VitePress Documentation**:
   - Add new package pages
   - Update architecture diagrams
   - Update code examples

#### Communication Plan

1. **Announcement**: Blog post or changelog entry
2. **Deprecation Warnings**: Add console warnings for old imports
3. **Codemod**: Provide automated migration script (optional)

### Phase 4: Deprecation and Removal (Future)

#### Version 2.0: Add Deprecation Warnings

Add runtime warnings when old imports are used:

```typescript
// packages/api/src/constructs/index.ts
import { Endpoint as _Endpoint } from '@geekmidas/constructs';

let warningShown = false;

export const Endpoint = new Proxy(_Endpoint, {
  construct(target, args) {
    if (!warningShown) {
      console.warn(
        'DEPRECATED: Importing Endpoint from @geekmidas/api/constructs is deprecated. ' +
        'Use @geekmidas/constructs instead. ' +
        'See migration guide: https://geekmidas.github.io/toolbox/migrations/constructs-schema-split'
      );
      warningShown = true;
    }
    return new target(...args);
  }
});
```

#### Version 3.0: Remove Old Exports (Breaking Change)

Remove re-exports from `@geekmidas/api/constructs`:
- Delete deprecated files
- Update major version
- Provide migration guide

## Testing Strategy

### Unit Tests

1. **Test Each New Package Independently**
   - `packages/constructs/src/__tests__/`
   - `packages/schema/src/__tests__/`

2. **Test Re-exports**
   - Verify old imports still work
   - Verify deprecation warnings

### Integration Tests

3. **Test CLI Build Process**
   - Verify builds work with new imports
   - Test all generators
   - Verify manifests are generated correctly

4. **Test Runtime Adapters**
   - AWS Lambda adapters
   - Hono adapter
   - Test adapters work with constructs from new package

### E2E Tests

5. **Test Example Applications**
   - Update `apps/example` to use new imports
   - Verify builds work
   - Verify runtime works

## Rollback Plan

If critical issues are discovered:

1. **Immediate**: Revert published npm packages
2. **Short-term**: Fix issues and republish
3. **Long-term**: If unfixable, delay refactoring

## Dependencies and Constraints

### Package Dependencies After Refactoring

```
@geekmidas/constructs
  ├── @geekmidas/schema
  ├── @geekmidas/logger
  ├── @geekmidas/events
  └── @standard-schema/spec

@geekmidas/schema
  ├── @standard-schema/spec
  └── openapi-types

@geekmidas/api
  ├── @geekmidas/constructs
  ├── @geekmidas/schema
  ├── @geekmidas/services (internal)
  ├── @geekmidas/logger
  └── hono

@geekmidas/cli
  ├── @geekmidas/constructs
  ├── @geekmidas/schema
  ├── @geekmidas/envkit
  └── fast-glob
```

### Breaking Changes

None in Phase 1-2. All changes are additive or backward compatible.

Phase 4 (v3.0) will have breaking changes:
- Old imports from `@geekmidas/api/constructs` will fail
- Migration required

## Risk Assessment

### Low Risk
- Creating new packages (additive)
- Re-exports for backward compatibility
- Documentation updates

### Medium Risk
- Import path changes in CLI
- Test updates
- Dependency ordering

### High Risk
- Runtime adapter integration
- Third-party packages depending on old structure
- Type inference changes

## Success Criteria

1. ✅ New packages created and published
2. ✅ All tests passing with new structure
3. ✅ Backward compatibility maintained
4. ✅ Documentation updated
5. ✅ Example apps working
6. ✅ CLI builds working
7. ✅ No performance regression
8. ✅ Bundle size reduced for api package

## Timeline

### Phase 1: Setup (Week 1-2)
- Create new packages
- Move code
- Set up re-exports
- Initial testing

### Phase 2: Integration (Week 3-4)
- Update CLI
- Update tests
- Update example apps
- Integration testing

### Phase 3: Documentation (Week 5)
- Write migration guide
- Update package docs
- Update architecture docs
- Create announcement

### Phase 4: Release (Week 6)
- Beta release
- Community testing
- Final release
- Announcement

### Phase 5: Deprecation (3-6 months later)
- Add deprecation warnings
- Monitor usage
- Provide support

### Phase 6: Removal (6-12 months later)
- Major version bump
- Remove old exports
- Final migration support

## Related Documents

- [Environment Variable Detection Design](./environment-variable-detection.md)
- [Service Pattern Documentation](../packages/api/docs/api-reference.md)
- [Schema Validation Guide](../packages/schema/docs/validation.md)

## Open Questions

1. **Should we move services.ts to @geekmidas/constructs?**
   - Services are used by constructs
   - But also used by API-specific code
   - Decision: Keep in api package for now, evaluate later

2. **Should rate-limit.ts move to @geekmidas/constructs?**
   - Rate limiting is HTTP-specific
   - Decision: Keep in api package

3. **How do we handle OpenAPI generation?**
   - OpenAPI is construct-aware
   - But schema conversion is in schema package
   - Decision: Keep high-level in constructs, utilities in schema

4. **Should we create @geekmidas/services as separate package?**
   - Services are generic, not API-specific
   - But tightly integrated with envkit
   - Decision: Defer to future refactoring

## Changelog

- **2025-10-13**: Initial planning document created
- **TBD**: Phase 1 started
- **TBD**: Phase 1 completed
- **TBD**: Released

---

**Status**: This is a planning document. Implementation has not started.

**Next Steps**:
1. Review this plan with the team
2. Get approval for the refactoring
3. Create implementation issues
4. Begin Phase 1 when approved
