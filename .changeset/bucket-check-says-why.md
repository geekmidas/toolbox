---
'@geekmidas/cli': patch
---

The s3 provider's bucket check says why, and buckets are addressed in their own region

A `HEAD` has no body, so SDK v3 names a 301, 400 or 403 `Unknown`, and the
deploy's check of a provisioned bucket printed exactly that. It now reads the
answer by its status and puts everything S3 said in the message: the status,
the error, `x-amz-bucket-region` and the request ids.

- **404**: "it does not exist".
- **403**: "the key is refused — AccessDenied, or an invalid or not-yet-active
  key". A key the deploy issued minutes ago (the stage's state records when)
  is waited for, about a minute, while IAM makes it usable.
- **301, or a 400 naming another region**: `BucketRegionMismatch`, naming the
  bucket's region and the one its URL says.
- Anything else: `HTTP <status> <name>`.

Provisioning reads where each bucket is rather than assuming the stage's
region: an adopted bucket in another region gets a URL naming its own region,
and a URL whose key is good but whose region is wrong is rewritten on the next
deploy. Probing a bucket name is read by status too, so a name another account
holds is no longer an `Unknown` failure.
