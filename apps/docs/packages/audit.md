# @geekmidas/audit

Type-safe audit logging with database integration for tracking application events and user actions.

## Installation

```bash
pnpm add @geekmidas/audit
```

## Features

- Type-safe audit actions with compile-time validation
- Transactional support for atomic database writes
- Pluggable storage backends (Kysely implementation included)
- Actor tracking (users, services, systems)
- Rich metadata support (request context, entity references)
- Query and filtering capabilities

## Package Exports

- `/` - Core types, Auditor interface, and DefaultAuditor
- `/kysely` - KyselyAuditStorage and withAuditableTransaction

## Basic Usage

### Define Audit Actions

```typescript
import type { AuditableAction } from '@geekmidas/audit';

// Define type-safe audit actions
type AppAuditAction =
  | AuditableAction<'user.created', { userId: string; email: string }>
  | AuditableAction<'user.updated', { userId: string; changes: string[] }>
  | AuditableAction<'order.placed', { orderId: string; total: number }>;
```

### Set Up Storage

```typescript
import { KyselyAuditStorage } from '@geekmidas/audit/kysely';

const storage = new KyselyAuditStorage<Database>({
  db: kyselyDb,
  tableName: 'audit_logs',
});
```

### Create and Use Auditor

```typescript
import { DefaultAuditor } from '@geekmidas/audit';

const auditor = new DefaultAuditor<AppAuditAction>({
  actor: { id: 'user-123', type: 'user' },
  storage,
  metadata: {
    requestId: 'req-456',
    endpoint: '/api/users',
  },
});

// Type-safe audit recording
auditor.audit('user.created', {
  userId: '789',
  email: 'test@example.com',
});

// Flush to storage
await auditor.flush();
```

## Transactional Audits

Use `withAuditableTransaction` to ensure audits are atomic with database operations:

```typescript
import { withAuditableTransaction } from '@geekmidas/audit/kysely';

const result = await withAuditableTransaction(
  db,
  auditor,
  async (trx) => {
    const user = await trx
      .insertInto('users')
      .values({ name: 'John', email: 'john@example.com' })
      .returningAll()
      .executeTakeFirstOrThrow();

    auditor.audit('user.created', {
      userId: user.id,
      email: user.email,
    });

    return user;
  },
);
```

## Integration with @geekmidas/constructs

```typescript
import { e } from '@geekmidas/constructs/endpoints';

const endpoint = e
  .post('/users')
  .body(UserSchema)
  .output(UserResponseSchema)
  .audit([
    {
      type: 'user.created',
      payload: (response) => ({
        userId: response.id,
        email: response.email,
      }),
    },
  ])
  .handle(async ({ body, auditor }) => {
    return { id: '123', ...body };
  });
```

## Database Schema

```sql
CREATE TABLE audit_logs (
  id VARCHAR(21) PRIMARY KEY,
  type VARCHAR(255) NOT NULL,
  operation VARCHAR(20) NOT NULL,
  "table" VARCHAR(255),
  "entityId" VARCHAR(255),
  "oldValues" JSONB,
  "newValues" JSONB,
  payload JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actorId" VARCHAR(255),
  "actorType" VARCHAR(50),
  "actorData" JSONB,
  metadata JSONB
);
```
