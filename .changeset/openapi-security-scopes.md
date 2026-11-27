---
'@geekmidas/constructs': minor
'@geekmidas/cli': minor
'@geekmidas/client': minor
---

The OpenAPI document says which scopes an endpoint needs, and every way to call it

- **Scopes.** `.authorizer('partners', { scopes: ['orders:write'] })` documents
  `security: [{ partners: ['orders:write'] }]`; before, scopes were always
  `[]`. A branch takes them too: `api.authorizer('partners', { scopes })`.
- **Alternatives.** `.authorizers(['session', { name: 'partners', scopes }])`
  is an endpoint that accepts either, documented as
  `security: [{ session: [] }, { partners: [...] }]`. `endpoint.authorizer`
  is still the first, which is what API Gateway and the manifest read;
  `endpoint.security` lists them all.
- **OAuth 2 schemes.** `oauth2ClientCredentials({ tokenUrl, scopes })`
  (RFC 6749 §4.4) and `oauth2AuthorizationCode({ authorizationUrl, tokenUrl,
  scopes })`, with PKCE by default as `x-usePkce: 'SHA-256'` (RFC 7636),
  declared with `RestApi`'s new `securitySchemes` option.
- **Generated client.** `gkm openapi --ts` collects every alternative's scheme.
  `endpointAuth` lists an endpoint's alternatives (`['session', 'partners']`)
  and still writes a single scheme as a string. The auth fetcher sends the
  first alternative it has a strategy for, and `authStrategies` requires a
  strategy only for a scheme some endpoint accepts on its own.
- An unknown authorizer throws `AuthorizerNotAvailable`, and an empty
  `.authorizers([])` `NoAuthorizersGiven`, rather than a bare `Error`.
