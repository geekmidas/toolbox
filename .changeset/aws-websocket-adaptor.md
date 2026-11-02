---
'@geekmidas/constructs': minor
'@geekmidas/cli': patch
---

A WebSocketApi on API Gateway is its own adaptor: `@geekmidas/constructs/aws-websocket`

`AmazonApiGatewayWebSocket`, `ApiGatewaySink` and `DynamoConnectionTable` moved
out of `@geekmidas/constructs/aws` into an entry that imports what it is built
on — `@aws-sdk/client-apigatewaymanagementapi`, `@aws-sdk/client-dynamodb` and
`electrodb` — directly. They are needed only by a project that serves a surface
from API Gateway, and stay optional peers of the package as a whole.

- The connection table is an ElectroDB entity. `DynamoConnectionTable` and
  `ApiGatewaySink` take their clients in the constructor; `create()` builds
  them from connection details.
- `services.<surface>` reaches an `apigateway://` publisher string through a
  sink driver the entry registers (`registerWebSocketSinkDriver`), as events
  and KMS ciphers are. `gkm build --provider aws` registers it in every entry
  that reaches a WebSocketApi; anywhere else the string fails with
  `UnregisteredWebSocketScheme`, naming the build to use.
- Connection ids keep their case. ElectroDB lowercases keys by default, which
  sent every post to an id API Gateway did not know: a 410, and the row was
  dropped as gone.
