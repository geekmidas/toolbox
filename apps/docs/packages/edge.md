# @geekmidas/edge

The edge in front of a gkm stack: the routes it serves, the reverse proxies
that serve them, where its certificates come from, and the DNS providers its
hosts are written through.

The CLI is its main reader: `gkm dev`, `gkm compose` and `gkm deploy` plan and
write the edge with it. It is a package of its own, not part of the CLI,
because the CLI isn't its only reader: anything that changes the edge while a
stack runs uses the same code, where the CLI isn't installed.

## Installation

```bash
pnpm add @geekmidas/edge
```

You rarely import it directly; the CLI does. You reach for it to write a DNS
provider of your own, or to read what the edge serves.

## Entry points

Each piece is its own entry point, so you load only what you use. Route 53's
entry is the only one that loads the AWS SDK, which is an optional peer:
install `@aws-sdk/client-route-53` and `@aws-sdk/credential-providers` only if
you use it.

| Import | What it is |
|---|---|
| `@geekmidas/edge/routes` | `EdgeRoute`: one public host and what answers it. Every proxy renders from it |
| `@geekmidas/edge/proxy/caddy` | Renders routes as a Caddyfile |
| `@geekmidas/edge/proxy/traefik` | Renders routes as Traefik's dynamic config, and the shared edge's own compose file |
| `@geekmidas/edge/certificates/local` | gkm's local certificate authority, which every local edge's certificate is issued from |
| `@geekmidas/edge/dns` | The `DnsProvider` interface, its record types, and the MX helpers |
| `@geekmidas/edge/dns/route53` | `Route53Provider` |
| `@geekmidas/edge/dns/hostinger` | `HostingerProvider` |
| `@geekmidas/edge/dns/godaddy` | `GoDaddyProvider` |

## DNS providers

A provider reads and writes one root domain's records:

```typescript
import type { DnsProvider } from '@geekmidas/edge/dns';

interface DnsProvider {
  readonly name: string;
  getRecords(domain: string): Promise<DnsRecord[]>;
  readRecords?(domain: string, wanted: readonly DeleteDnsRecord[]): Promise<DnsRecord[]>;
  upsertRecords(domain: string, records: UpsertDnsRecord[]): Promise<UpsertResult[]>;
  deleteRecords(domain: string, records: DeleteDnsRecord[]): Promise<DeleteResult[]>;
}
```

A workspace names one per root domain in `dns`, a built-in by name or an
object of your own:

```typescript
// gkm.config.ts
import { myDnsProvider } from './dns/myProvider';

export default defineWorkspace({
  dns: {
    'myapp.com': { provider: 'route53', hostedZoneId: 'Z0123456789EXAMPLE' },
    'myapp.dev': { provider: myDnsProvider },
  },
});
```

Every value is a record's zone-file form: an MX record's is
`<priority> <host>`, built with `mxValue(priority, host)` and read with
`parseMxValue(value)`.

### Credentials

The providers take their credentials as given and never look for them.
Hostinger and GoDaddy take a function, called the first time the API is used,
so a provider that is built and never called reads nothing:

```typescript
import { GoDaddyProvider } from '@geekmidas/edge/dns/godaddy';

const godaddy = new GoDaddyProvider({
  credential: async () => ({ token: await readToken() }),
});
```

Where a token comes from (`GODADDY_API_TOKEN`, `gkm login --provider godaddy`)
and what to say when there is none is the CLI's business. Route 53 uses the
AWS credential chain, or the `profile` it is given.

::: warning Scope the credentials to what you use
A DNS credential can usually delete a zone, move your mail or transfer the
domain. Give it only the zones, record types and names your stages use, and
keep it on the machine that runs the deploy. Route 53 can be limited to one
zone, record names and record types through IAM; a GoDaddy token to
`domains.dns:update`; a Hostinger token can't be limited at all. See
[Scope each provider's credentials](../guide/deployment.md#scope-each-provider-s-credentials-to-what-gkm-does)
for a Route 53 policy and what to do for each provider.
:::

## The local certificate authority

One per machine, under the home it is given (the CLI passes `GKM_HOME`, or
`~/.gkm`). Every local edge's certificate is issued from it, so there is one
root to trust (`gkm trust`). Its key never leaves that directory.

```typescript
import {
  ensureLocalAuthority,
  ensureLocalCertificate,
  localAuthorityPaths,
} from '@geekmidas/edge/certificates/local';

const authority = await ensureLocalAuthority(localAuthorityPaths(home));
```

## Errors

Errors the edge raises on purpose extend `EdgeError` (from
`@geekmidas/edge`). The CLI prints one as its message alone, without a stack
trace, as it does its own.
