---
'@geekmidas/manifest': patch
'@geekmidas/constructs': patch
'@geekmidas/cli': patch
---

Self-hosted telemetry: the parts that are the same on every stage move to the `Telemetry` construct, and two stages on one server no longer clash on the logs port.

- **Breaking for `public` log UIs:** the host is the construct's label, `telemetry.<stage domain>` for `new Telemetry('Telemetry')`, instead of the hardcoded `logs.<stage domain>`. The next deploy plans the new DNS record and certificate. To keep the old host, set `subdomain: 'logs'`.
- `Telemetry` takes `subdomain` (checked as one DNS label, `InvalidHostLabel`) and `image` (the OpenObserve image, verbatim, for both `gkm dev` and compose; defaults to the pinned one).
- The telemetry label is claimed like an app's: an app, alias or wildcard tenant on it fails with `HostLabelTaken`, and a `protectedSubdomains` entry repeating it with `ProtectedSubdomainIsAnApp`.
- **Logs port on a shared server:** before anything changes, a deploy reads what other stacks on the server publish.
  - With no `deploy.telemetry.<stage>.port`, the stack keeps the port it already publishes, or takes the first free one from 5080 up, and prints that tunnel.
  - A port the stage names that another stack holds fails with `LogsPortTaken`.
- Two `Telemetry` nodes that give the stack's one OpenObserve different labels or images fail with `TelemetryNodesDisagree`.
