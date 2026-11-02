---
'@geekmidas/constructs': minor
'@geekmidas/cloud': minor
'@geekmidas/cli': minor
'@geekmidas/manifest': minor
'@geekmidas/envkit': minor
---

A `WebSocketApi` deploys to AWS: API Gateway serves the same surface compose does

Until now a `WebSocketApi` ran only as a Node process. A project deploying to
AWS had to keep a hand-written API Gateway WebSocket API next to it, with its
own `$connect`/`$disconnect` Lambdas and its own `postToConnection` publisher.
The same surface now deploys to both targets, unchanged.

- **`AmazonApiGatewayWebSocket`** (`@geekmidas/constructs/aws`) is the API
  Gateway adaptor over the surface's `WebSocketCore`. `$connect` checks the
  Origin and calls `connect()`, and a refusal answers with its status.
  Each route calls `message()`, and its reply is posted back to the caller.
  `$disconnect` calls `disconnect()`. A connection's `data` is kept in a
  DynamoDB connection table between invocations.
- **`services.<surface>`** on AWS sends through the management API.
  `<ID>_PUBLISHER_CONNECTION_STRING` is an `apigateway://` string there, so the
  same `.dependsOn([realtime])` works from any Lambda. A connection that
  answers 410 is dropped from the table, not reported. `broadcast` sends to
  every id in the table.
- **`gkm build --provider aws`** writes one Lambda per route under
  `.gkm/aws/websocket/`, plus `$connect` and `$disconnect` even when the
  surface declares neither.
- **`fromManifest`** (`@geekmidas/cloud`) provisions a `websocket-api` as a
  `WebSocketApiSurface`: an API Gateway WebSocket API that routes on the
  frame's action key, and its connection table. It mounts each route linked
  to what that route depends on. `$connect` is also linked to the surface's
  authenticator.
- The `sst` target skips the HTTP health check for a WebSocket surface,
  because API Gateway has no HTTP path to ask.

New optional peers of `@geekmidas/constructs`, which only the AWS adaptor
loads, and only when it first needs them: `@aws-sdk/client-apigatewaymanagementapi`
and `@aws-sdk/client-dynamodb`. A surface on compose never loads either.

The limits on AWS are API Gateway's, and are documented with the surface:
connections last at most 2 hours (10 minutes idle), frames are 128 KB, and
API Gateway chooses its own close code.
