---
'@geekmidas/cli': patch
'@geekmidas/constructs': minor
---

SNS topic subscribers start under `gkm dev` without `@middy/core`

`SnsPushSubscriberAdaptor` handed each pushed notification to `AWSLambdaSubscriber`, which imports `@middy/core`. middy is an optional peer that only Lambda needs, so a project that doesn't deploy to Lambda didn't install it, and every SNS subscriber logged `Failed to set up subscriber` with `ERR_MODULE_NOT_FOUND`. The push adaptor now runs the subscriber directly, with the same parsing, services, database and error handling as the Lambda adaptor. middy stays in the Lambda wrapper only.

- **Breaking (alpha):** `SnsPushSubscriberAdaptor` moved from `@geekmidas/constructs/aws` to `@geekmidas/constructs/subscribers`. Every other export of `/aws` loads middy.
- A subscriber that fails to set up now logs the error's message, which names the missing module.
- A subscriber whose output fails its `.output()` schema throws `SubscriberOutputInvalid` instead of a bare `Error`.
