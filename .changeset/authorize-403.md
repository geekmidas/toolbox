---
"@geekmidas/constructs": patch
---

Return 403 Forbidden instead of 401 Unauthorized when an endpoint's `.authorize()` returns false. Authorization runs after `getSession()`, so by the time it rejects, the caller is already identified — 403 is the correct semantic. Callers that want 401 for missing authentication should throw `UnauthorizedError` from `getSession()` (or `.authorize()`) directly.
