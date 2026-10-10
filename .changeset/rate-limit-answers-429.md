---
'@geekmidas/rate-limit': patch
'@geekmidas/errors': patch
'@geekmidas/constructs': patch
---

:bug: An endpoint over its `.rateLimit()` answers 429 with `Retry-After`, not 500

- **`TooManyRequestsError` is `@geekmidas/errors`' 429.** The limiter's own error carried `statusCode = 429` but was not an `HttpError`, so every adaptor's `wrapError` turned it into a 500 "Internal Server Error". `@geekmidas/rate-limit` now throws (and re-exports) the errors package's class, carrying `Retry-After` — the seconds until the window resets — and the `X-RateLimit-Limit`/`-Remaining`/`-Reset` headers.
- **An `HttpError` says which headers its response carries** (`headers`, set by an option on `HttpError` and by `TooManyRequestsError`'s `retryAfter`), and the Hono and API Gateway adaptors set them on the error response.
- **Every adaptor checks the limit**: API Gateway Lambdas and `TestEndpointAdaptor` ignored `.rateLimit()`; they now check it after authorization, as Hono does, and put `X-RateLimit-*` on a success.
- **`wrapError` has one rule**: an `HttpError` passes through; anything else — a `statusCode` field included — is a 500.
