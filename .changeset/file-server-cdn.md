---
'@geekmidas/cli': minor
'@geekmidas/constructs': minor
'@geekmidas/manifest': minor
---

A file server over an `s3` bucket is served through a CDN

On a stage whose buckets the `s3` provider creates, a `FileServer` used to
answer on the bucket's regional endpoint — one region for every reader, on an
`amazonaws.com` host, with its open paths public on the bucket itself. The
deploy now serves each file server through CloudFront on
`<fileserver>.<domain>`, and that is its URL:

- an ACM certificate (us-east-1) for the name, validated by a CNAME written
  through the root domain's DNS provider in `dns` and kept for renewals; a
  domain nothing writes prints the record and stops with
  `CdnCertificatePending`, and the next deploy carries on from there;
- an origin access control, and a bucket policy granting exactly the stage's
  distributions `s3:GetObject` on exactly the open prefixes — the bucket is
  never public, and Block Public Access keeps all four flags on;
- response headers policies: CORS for the stage's sites, and
  `Cache-Control: public, max-age=31536000, immutable` on the paths a file
  server now calls `immutable` (`new FileServer('Assets', { open, immutable })`,
  a subset of `open` or `ImmutableNotOpen`; `FileServerDeclaration.immutable`
  in the manifest);
- a distribution on the name — HTTPS only, compressed, cached on the path
  alone — and a CNAME to it.

Each is recorded in the stage's state, found again by name when a run died
before recording it, and put back when it drifted; nothing is deleted. A stage
with file servers and no domain fails with `FileServerCdnNeedsDomain`;
`deploy.objects.<stage>.cdn: false` keeps the bucket's own endpoint. The
deploy role from `gkm deploy:github` is given the ACM and CloudFront actions,
none of which delete.
