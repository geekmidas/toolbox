# Deploy Walkthrough: Manifest → SST

- **Status**: Draft
- **Companion to**: [Constructs Paradigm](./constructs-paradigm.md)

An implementation walkthrough, not a design argument. It takes one realistic app,
shows the manifest it produces, and walks what `Stack.fromManifest` does with it —
the point being to find what the manifest needs *before* its shape is frozen.

Findings are collected in [The Delta](#the-delta) at the end. Two of them are
structural.

## The app

```ts
// src/resources.ts
export const uploads    = new ObjectStorage('Uploads');
export const orders     = new KyselyDatabase<OrdersDB>('Orders');
export const ordersRead = orders.reader();
export const authDb     = orders.schema<AuthDB>('Auth');

// src/auth.ts
export const auth = new BetterAuth('Auth', { database: authDb, basePath: '/api/auth' });

// src/apis.ts
export const api      = new RestApi('Api',      { authorizers: [auth], default: auth });
export const webhooks = new RestApi('Webhooks', { authorizers: ['stripe'], default: 'stripe' });

// src/events.ts
export const userEvents = t.name('UserEvents').events({
  'user.created': z.object({ id: z.string(), email: z.string() }),
});

// src/functions.ts
export const sendEmail = f.name('SendEmail').input(emailSchema).handle(…);

// src/queues.ts
export const processOrder = q.name('ProcessOrder')
  .message(z.object({ orderId: z.string() }))
  .dependsOn([orders])
  .handle(…);

// src/api/orders.ts
export const createOrder = api.post('/orders')
  .database(orders).dependsOn([uploads, processOrder]).handle(…);
export const listOrders  = api.get('/orders')
  .dependsOn([ordersRead]).handle(…);

// src/api/webhooks.ts
export const stripeHook = webhooks.post('/stripe').dependsOn([orders]).handle(…);

// src/subscribers.ts
export const sendWelcome = userEvents.name('SendWelcome')
  .on(['user.created']).dependsOn([sendEmail]).handle(…);

// src/crons.ts
export const dailyReport = c.name('DailyReport')
  .schedule('0 6 * * *').dependsOn([ordersRead]).handle(…);
```

## The manifest

```jsonc
{
  "Uploads": { "kind": "objects", "provides": ["UPLOADS_URL"] },

  "Orders": { "kind": "database", "provides": ["ORDERS_URL"],
              "schema": "app", "roles": ["app", "app_owner"] },

  "OrdersReader": { "kind": "database-reader", "of": "Orders",
                    "provides": ["ORDERS_READER_URL"] },

  "Auth": { "kind": "database-schema", "of": "Orders", "schema": "auth",
            "provides": ["AUTH_URL"], "roles": ["auth", "auth_owner"] },

  "Api": { "kind": "rest-api", "provides": ["API_URL"],
           "authorizers": ["Auth"],
           "endpoints": [
             { "id": "CreateOrder", "handler": "…", "method": "POST", "path": "/orders",
               "authorizer": "Auth", "database": "Orders",
               "dependencies": [{ "target": "Uploads",      "kind": "objects" },
                                { "target": "ProcessOrder", "kind": "queue" },
                                { "target": "Orders",       "kind": "database" }],
               "requires": ["UPLOADS_URL", "PROCESS_ORDER_URL", "ORDERS_URL"] },
             { "id": "ListOrders", "handler": "…", "method": "GET", "path": "/orders",
               "authorizer": "Auth",
               "dependencies": [{ "target": "OrdersReader", "kind": "database-reader" }],
               "requires": ["ORDERS_READER_URL"] }
           ]},

  "Webhooks": { "kind": "rest-api", "provides": ["WEBHOOKS_URL"],
                "authorizers": ["stripe"],
                "endpoints": [
                  { "id": "StripeHook", "handler": "…", "method": "POST", "path": "/stripe",
                    "authorizer": "stripe",
                    "dependencies": [{ "target": "Orders", "kind": "database" }],
                    "requires": ["ORDERS_URL"] }
                ]},

  "UserEvents": { "kind": "topic", "provides": ["USER_EVENTS_URL"],
                  "events": ["user.created"],
                  "subscribers": [
                    { "id": "SendWelcome", "handler": "…", "events": ["user.created"],
                      "dependencies": [{ "target": "SendEmail", "kind": "function" }],
                      "requires": ["SEND_EMAIL_URL"] }
                  ]},

  "ProcessOrder": { "kind": "queue", "provides": ["PROCESS_ORDER_URL"],
                    "worker": { "id": "ProcessOrderWorker", "handler": "…",
                                "dependencies": [{ "target": "Orders", "kind": "database" }],
                                "requires": ["ORDERS_URL"] }},

  "SendEmail": { "kind": "function", "handler": "…",
                 "provides": ["SEND_EMAIL_URL"], "requires": [], "dependencies": [] },

  "DailyReport": { "kind": "cron", "handler": "…", "schedule": "0 6 * * *",
                   "dependencies": [{ "target": "OrdersReader", "kind": "database-reader" }],
                   "requires": ["ORDERS_READER_URL"] }
}
```

## The walk

### A. Provision the addressable nodes

Everything top-level that owns an address. **Resources are leaves** — they never
depend on another construct — so order within this phase is free.

```ts
for (const [id, d] of entries(m)) {
  if (isFunctionKind(d.kind)) continue;
  provisioned[id] = PROVISIONERS[d.kind](stack, id, d);
}
```

| id | creates |
|---|---|
| `Uploads` | `sst.aws.Bucket`, name `prod-myapp-uploads` |
| `Orders` | RDS database `orders`; schema `app`; roles `app`, `app_owner`; two secrets |
| `Api`, `Webhooks` | `sst.aws.ApiGatewayV2` each, domain from the stage's map |
| `UserEvents` | `sst.aws.SnsTopic` |
| `ProcessOrder` | `sst.aws.Queue` + DLQ |

`OrdersReader` and `Auth` **provision nothing new** — they are views on `Orders`.
The reader resolves the cluster's reader endpoint; the schema tenant adds a
schema and roles to a database that already exists. Both need `Orders` first,
which is the only ordering constraint in this phase (see [Delta 1](#the-delta)).

### B. Migrate

Between provisioning and any function that reads the database, using the
**owner** URL:

```
Orders  → app schema migrations   (owner: app_owner)
Auth    → Better Auth's schema    (owner: auth_owner)
```

This is a phase of the walk, not a step inside it: it needs the database to
exist and must complete before a single function is invocable. On AWS it runs
**inside the VPC** — a one-off task or Lambda, not from CI.

### C. Create the functions

Every `handler`, wherever it sits — top-level (`SendEmail`, `DailyReport`) or
nested (`Api.endpoints[]`, `UserEvents.subscribers[]`, `ProcessOrder.worker`).
Each one's links and environment come from **its own** `dependencies`:

```ts
const link = fn.dependencies.map((d) => provisioned[d.target].linkable);
const env  = Object.assign({}, base, ...fn.dependencies.map(
  (d) => provisioned[d.target].provides()
));
```

Worked for `CreateOrder`:

| from | link | env |
|---|---|---|
| `Uploads` | bucket → `s3:*` on it | `UPLOADS_URL` |
| `ProcessOrder` | queue → `sqs:SendMessage` | `PROCESS_ORDER_URL` |
| `Orders` | database → SG + secret read | `ORDERS_URL` |

and `ListOrders` gets **only** `ORDERS_READER_URL` and read-only access — no
bucket, no queue, no writer. That asymmetry is the least-privilege property,
falling out of the edges rather than out of discipline.

`fn.requires` is not used here — it is derivable from the same edges. It earns
its place as a **check**: assert the composed env keys equal `requires`, and a
drift between what the app declared and what infra supplied fails at synth.

**Ordering.** `SendWelcome` needs `SendEmail`'s ARN. Pulumi outputs are lazy, so
referencing an unprovisioned resource is fine — no topological sort needed, the
engine orders it. Worth knowing rather than defending against.

### D. Wire the triggers

Position in the manifest *is* the trigger, so this is a walk of the nesting:

| nesting | wires |
|---|---|
| `Api.endpoints[]` | route on that gateway, authorizer by name, description `POST /orders` |
| `UserEvents.subscribers[]` | SQS queue + DLQ per subscriber, SNS subscription with a filter policy on `events` |
| `ProcessOrder.worker` | event-source mapping, `batchSize` |
| `DailyReport` | EventBridge schedule |

Nothing is searched for. Each surface hands the walk its own children.

## The Delta

What the walk needs that the manifest didn't have.

### 1. Derived constructs need to name their parent — **structural**

`OrdersReader` and `Auth` are not independent nodes: one is an endpoint on an
existing cluster, the other a schema inside an existing database. Without a
parent reference the adapter would provision a second database for each.

Added above as `"of": "Orders"`, with kinds `database-reader` and
`database-schema`. This is the first field that makes a top-level node
*dependent*, and it introduces the phase's only ordering constraint — parents
before children.

It also needs validating: `of` must resolve, and must point at a `database`.

### 2. Migration sets are undeclared — **structural**

The manifest says a database exists; it doesn't say what to migrate into it, or
that Better Auth brings its own schema. Phase B currently has to infer both.

A database node needs to carry its migration source, and a schema tenant needs
to say whose migrations own it — the app's are in the project, Better Auth's come
from the library.

### 3. `requires` is a check, not an input

The adapter composes env from `dependencies`, so `requires` is never read to
build anything. Keep it — as an assertion it catches app/infra drift at synth —
but its role is narrower than "the function's environment", and the doc should
say so.

### 4. Logical ids are stable, iteration order is not a hazard

SST names resources from the id we pass, not from creation order, so a reordered
manifest doesn't churn infrastructure. I had expected to need a guaranteed
iteration order; it isn't necessary.

### 5. `authorizers` mixes references and names

`Api` lists `["Auth"]` — a construct id — while `Webhooks` lists `["stripe"]`, a
name the cloud implementation resolves. The adapter has to tell them apart,
currently by checking whether the string resolves in the manifest. That works but
is implicit; worth an explicit shape before it becomes load-bearing.
