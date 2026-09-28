---
'@geekmidas/testkit': patch
---

`memoryAdapter` passes better-auth's own adapter conformance suites again

better-auth 1.7 moved the harness `runAdapterTest` came from into
`@better-auth/test-utils/adapter`. `memoryAdapter` now runs its basic,
auth-flow and case-insensitive suites (129 tests), plus a sign-up → sign-in →
session-from-cookie check through `auth.handler`.

The suites found two gaps, both fixed:

- **`mode: 'insensitive'` was ignored.** `eq`, `ne`, `in`, `not_in`,
  `contains`, `starts_with` and `ends_with` now compare case-folded strings when
  asked to, as the SQL adapters do.
- **`findMany` ignored `select`**, and once it didn't, looked selected fields up
  by their schema name instead of their stored name — so a schema that renames
  a field (`fields: { email: 'email_address' }`) lost it.
