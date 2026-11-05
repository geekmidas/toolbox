# Domains, Aliases and Redirects

Every surface and site answers on one label under its stage's domain: its
`subdomain`, or its id kebab-cased, and the root site on the domain itself
(see [Hostnames are the exception](./naming.md#hostnames-are-the-exception)).
That label is what the construct **is called**: `<ID>_URL`, a typed client's
base URL and the OpenAPI `servers` entry are all built on it.

Two opt-in fields add hosts beside it. Neither is a mode, and nothing is added
for you: there is no automatic `www`.

```ts
// another host the API really answers on
export const api = new RestApi('Api', { path: 'apps/api', aliases: ['rest'] });
// api.example.com (canonical) and rest.example.com

// another name that sends the browser to the one host — sites only
export const web = new StaticSite('Web', {
  path: 'apps/web',
  redirects: ['www'],
});
// www.example.com → 301 → example.com, path and query kept
```

| | `aliases` | `redirects` |
| --- | --- | --- |
| On | `RestApi`, `WebSocketApi`, `StaticSite` | `StaticSite` only |
| Meaning | answers on both hosts | one host; the other points at it |
| CORS and trusted origins | a site's alias origins are trusted by every surface it depends on | nothing: the browser only runs on the canonical host |
| Cookies and storage | split per host | one origin |
| Typical use | an API under a second name (`rest.` beside `api.`) | `www.` in front of a site |

`redirects` is not on a surface's type: an API client does not reliably follow
a `301` on a `POST`.

## Labels, not hostnames

An alias or a redirect is a **label**, like `subdomain`, so it follows each
stage's domain, the local names and the stage suffix by the same rule a
construct's own label does:

| Stage | `Web` with `redirects: ['www']` | `Api` with `aliases: ['rest']` |
| --- | --- | --- |
| production (`example.com`) | `www.example.com` → `example.com` | `rest.example.com` |
| `gkm dev` | `www.shop.localhost` → `shop.localhost` | `rest.shop.localhost` |
| `gkm test` | `www-test.shop.localhost` → `test.shop.localhost` | `rest-test.shop.localhost` |

Each entry is one lowercase label. The construct is refused when it is built
if an entry cannot be one:

- **`InvalidHostLabel`**: `'*'`, a dot (`'rest.v2'`), an entry listed twice,
  or the construct's own label.
- **`HostLabelBothAliasAndRedirect`**: one label in both lists. A host either
  serves the site or sends the browser elsewhere.
- **`WildcardSiteCannotHaveAliases`**: a [site on every
  subdomain](./naming.md#a-site-on-every-subdomain) with either field. It has
  no single host for an alias to repeat or a redirect to point at.

## Who owns a label

An alias or a redirect belongs to its construct as much as its own label does:

- **A tenant never takes it.** A wildcard site's protected labels include every
  alias and redirect, so `rest.example.com` is never served as a tenant named
  `rest`. Listing one in `protectedSubdomains` is an error
  (`ProtectedSubdomainIsAnApp`): it is protected without being listed.
- **Two constructs never share it.** An alias that is another app's label, or a
  label two apps both list, fails when the workspace loads (`HostLabelTaken`),
  before anything is deployed. A file server's host is checked the same way
  (`FileServerHostTaken`).

## On the edge

The local `gkm dev` edge and both `gkm compose` proxies render the same route
model, so the hosts are the same whichever runs:

- **Caddy** puts the aliases in the site block, `https://api.example.com,
  https://rest.example.com { … }`, so every check in the block — a password, a
  path allowlist, a file server's processor paths — holds on each host. Each
  redirect is a block of its own:
  `redir https://example.com{uri} permanent`.
- **Traefik** matches
  ``(Host(`api.example.com`) || Host(`rest.example.com`))``.
  The rule is parenthesised, so the path allowlist, a required header and the
  stack's own token hold on every host, and a file server's processor routers
  use the same rule. Each redirect host has a router of its own with a
  permanent `redirectRegex` to the canonical host, and no service behind it.
- **Claims.** A stack claims every host on the shared edge, aliases and
  redirects included, so another stack on the server can't route one.

## DNS and certificates

`gkm compose` writes a record for every alias and redirect, checks each one
resolves before the stack starts, and prunes a record the stage no longer
serves, as it does for every other host. Let's Encrypt issues one certificate
per router: a construct and its aliases share one certificate with every name,
and each redirect host has its own. Locally, gkm's CA issues the stage's
certificate for every host the edge serves.

## On AWS

SST gives no surface but a wildcard site a custom domain, so there is nothing
to put an alias under. An alias or a redirect on an AWS stage fails the
deploy with `HostLabelNeedsCustomDomain`, naming the construct. It is never
silently dropped. Deploy the stage with `gkm compose`, or remove the field.
