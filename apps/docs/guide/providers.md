# Providers

A construct says a thing exists: `new ObjectStorage('Uploads')` is a bucket.
What backs it on a deployed stage is the stage's to say, under
`deploy.<kind>.<stage>` — the key is the construct's manifest kind. A stage
that names a **provider** has its deploy create the backing resource in the
stage's own account and write its connection value into the stage's secrets,
where the rest of the deploy reads it as if you had set it by hand.

```ts
// gkm.config.ts
deploy: {
  objects: {
    production: { provider: 's3', region: 'eu-west-1' },
    staging: 'external',        // the default: the keys are yours to set
    scratch: false,             // no object storage on this stage at all
  },
}
```

```bash
gkm deploy --stage production --dry-run   # what would be created or changed
gkm deploy --stage production             # create it, fix drift, write the keys, deploy
```

`gkm compose --stage production` is the same deploy, and runs the providers
the same way.

The first kind is `objects` — what `ObjectStorage` and `FileServer` produce.
`cache` and `email` take the same `deploy.<kind>.<stage>` shape as their
providers arrive.

## What a provider is

| Part | What it is |
|---|---|
| provisioning credentials | What *creates* the resource — the stage account's admin credentials. Read only by the deploy, never given to an app. |
| `ensure()` | Run by every deploy, before its checks. Idempotent find-or-create. Tries a good, deterministic name; records what it made in the stage's state; puts back what drifted. **Never deletes.** |
| runtime credentials | The keys it writes into the stage's secrets for the apps: for `s3`, the bucket's URL with a key scoped to it. |
| `verify()` | The cheap check every deploy runs: for `s3`, `HeadBucket` with the key in the stage's secrets. |

## `deploy.objects.<stage>`

| Value | Meaning |
|---|---|
| `'external'` (or nothing) | Today's behaviour. Each bucket's `<ID>_URL` and each file server's `<ID>_URL` are set in the stage's secrets by you — S3, R2, any S3-compatible store. A missing key fails `validate` with `ExternalServicesNotConfigured`. |
| `{ provider: 's3', region?, versioning? }` | Every deploy of the stage creates and maintains the buckets in the stage's AWS account and writes their keys. |
| `false` | The stage has no object storage. A deploy of a workspace that declares a bucket is refused with `StageProviderDisabled`. |

Anything else — `'minio'` included — fails to load with `UnknownStageProvider`,
which lists what is accepted. The local stage ignores `deploy.objects`: `gkm
dev` and `gkm compose` on it always run MinIO.

- `region` — where the buckets are created. Defaults to the secrets store's
  region (`secrets.store.region`), then `AWS_REGION`.
- `versioning` — keep previous versions of every object. Defaults to the
  construct's own `versioned`.

## `objects: s3`

Per bucket construct, on the stage:

**The bucket.** Named `<namespace>-<project>-<stage>-<id>` (the project alone
when `deploy.namespace` is unset): lowercase, no dots, at most 56 characters —
the longest part is shortened first — so a suffix still fits S3's 63.

- `CreateBucket` in the configured region (no `LocationConstraint` in
  `us-east-1`).
- `BucketAlreadyOwnedByYou` — the account already holds it: reused, unless
  its `gkm:project` tag names another project (`BucketOwnedByAnotherProject`).
- `BucketAlreadyExists` — another account holds the name: a random six
  character `[a-z0-9]` suffix is appended and the create retried, up to five
  times, then `BucketNameUnavailable` lists every name tried.
- **The final name is recorded in the stage's state and reused forever** — a
  later run never regenerates it, and a recorded bucket that has disappeared
  is created again under the same name.

Its settings, checked on every run and put back when they drifted:

- Block Public Access, all four flags on;
- default encryption, SSE-S3;
- a bucket policy denying every request not made over TLS
  (`aws:SecureTransport` false);
- versioning, when asked for (turned off, it is *suspended*, never stripped);
- CORS allowing `GET`, `HEAD`, `POST` and `PUT` from the stage's sites that
  call an API using the bucket — read off the graph the way an API's own CORS
  origins are — exposing `ETag`. A site with no address on the stage (no
  `domains.<stage>`) is named and left out;
- tags `gkm:project`, `gkm:stage`, `gkm:construct`.

**The IAM user.** `gkm-<project>-<stage>-<id>` (64 characters at most), under
the path `/gkm/`, tagged with the deploy identity — so gkm finds its own users
and never touches anyone else's (`IamUserNotOwned`). Its one inline policy,
`gkm-bucket`, covers that bucket only:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GkmObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject",
                 "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::<bucket>/*"
    },
    {
      "Sid": "GkmBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation",
                 "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::<bucket>"
    }
  ]
}
```

`s3:GetObjectVersion` is added when the bucket keeps versions.

**The key.** Created once and written into the stage's secrets as the bucket's
URL — `UPLOADS_URL=s3://KEY:SECRET@<bucket>?region=<region>`, percent-encoded.
The key id is recorded in the state; the secret is never printed.

**A `FileServer`.** Its URL (`UPLOADS_SERVER_URL`) becomes the bucket's
regional endpoint, `https://<bucket>.s3.<region>.amazonaws.com` — what
`uploads.url('brand/logo.png')` appends a key to. A URL you set yourself (a
CDN) is kept. When the file server has `open` paths, they are public on
exactly those prefixes — `s3:GetObject` for `Principal: *` on
`arn:aws:s3:::<bucket>/brand/*` — and Block Public Access is relaxed only as
far as that needs: `BlockPublicPolicy` and `RestrictPublicBuckets` off, ACLs
still blocked. A bucket with no open paths keeps all four flags on.

A single `*` in an S3 policy crosses `/`, so `avatars/*.png` is wider in the
policy than in the construct's own check, which stops at a segment. Prefer
`**` where crossing segments is what you meant.

## Credentials

The deploy provisions in the stage's AWS account with the credentials of the
machine it runs on, found the way the SSM and Secrets Manager stores find
them:

1. `AWS_PROFILE`, else `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
   (`AWS_SESSION_TOKEN`) — in CI, what `aws-actions/configure-aws-credentials`
   exports;
2. the SDK's default chain — `~/.aws`'s default profile, SSO, a role.

**None of them**: the deploy stops before anything is created with
`ProviderCredentialsMissing`, naming the environment it reads. In CI it is
the stage environment's role (`AWS_ROLE_ARN`, from
[`gkm deploy:github`](./deployment.md#what-the-role-may-do), which grants
exactly what the stage's buckets and users need), assumed before the step
that runs the deploy. To set the keys by hand instead, set
`deploy.objects.<stage>: 'external'`.

The providers run first, then the deploy's one readiness check, so
`ExternalServicesNotConfigured` never reports a key the deploy creates. A
build (`gkm compose --build --push`) runs neither: it needs none of the keys.

In the [compose workflow](./compose.md#deploying-from-ci) the whole deploy
runs on the runner, with the stage's role, and drives the server's Docker over
SSH: the stage account's credentials never reach the server.

The apps never see the provisioning credentials: only the bucket's own key, in
its URL.

## `--dry-run`

```bash
gkm deploy --stage production --dry-run
```

Reads the account (with the provisioning credentials) and the stage's state,
and prints each change it would make:

```text
☁️  objects: s3 (dry run)
   would create in eu-west-1 — bucket acme-shop-production-uploads
   would encrypt by default (SSE-S3) — bucket acme-shop-production-uploads
   would create under /gkm/ — IAM user gkm-acme-shop-production-uploads
   would create an access key — IAM user gkm-acme-shop-production-uploads
   …
```

Nothing is created, and nothing is written to the stage's secrets or state.
No secrets are generated for the stage either. A run that finds nothing to
change prints "up to date".

## Rotating a key

```bash
gkm deploy --stage production --rotate-keys   # a second key; this deploy releases on it
gkm deploy --stage production                 # the old key is deleted
```

1. `--rotate-keys` creates a second key for each user, writes it into the
   stage's secrets in place of the first, and records the old one in the
   state. The same deploy then releases the apps on the new key. Both keys
   work until the old one is deleted.
2. The **next** deploy deletes the old key.
3. `gkm deploy --stage <stage> --retire-old-keys` deletes it at once.

`gkm compose --stage <stage>` takes the same two flags.

Rotating again while an old key is still active fails with
`RotationInProgress`. IAM allows two keys per user; a user that already has
two fails with `AccessKeyLimit`, naming them.

If the stage's secrets lose the key (a store emptied by hand), the next run
issues a new one the same way — a secret cannot be read back from IAM.

## Never deletes

`ensure()` creates and repairs; it never removes a bucket, an object, a user or
a policy, and a construct you remove from the code leaves its bucket where it
is. The one deletion is the old access key a `--rotate-keys` replaced, after
the deploy that stopped using it, or when you pass `--retire-old-keys`.

## DNS records

The deploy also points a compose stage's public hosts at its server, through
the DNS provider each root domain names in `dns`:

```ts
// gkm.config.ts
domains: { production: 'shop.example.com' },
dns: { 'example.com': { provider: 'godaddy' } },
deploy: { default: 'compose' },
```

```bash
gkm secrets:set GKM_SERVER_IPV4 '203.0.113.10' --stage production
gkm deploy --stage production --dry-run   # the exact records, and what changes
gkm deploy --stage production             # write them, then deploy
```

It is a provider like the others in every way that matters:

- **Provisioning credentials** come from the machine running the deploy — the
  DNS provider's token (`GODADDY_API_TOKEN` or `gkm login --provider godaddy`,
  `HOSTINGER_API_TOKEN` or `gkm login --provider hostinger`), the AWS SDK
  chain for Route53. With a token provider and no token, the deploy fails at
  its start with `DnsCredentialMissing`, naming the key. In CI the token is a
  secret on the stage's environment, read by the runner's deploy step, so the
  server never holds it.
- **Idempotent.** A record that already has the right value is left alone; one
  with another value is replaced, printing `old → new`. Only the A, AAAA and
  CNAME records of the stage's own hosts are ever written — one per host,
  never a wildcard (`DnsWildcardRefused`) — and none is ever deleted. A new
  app's host gets its record from the next deploy.
- **`--dry-run`** prints each record — name, type, value, TTL — and whether it
  would be created, updated or left alone, and writes nothing.
- **Confirmed** by reading the records back from the provider
  (`DnsRecordsNotConfirmed` if they are not there), before the stack starts
  and asks for certificates — see the
  [compose guide](./compose.md#the-dns-check).
- **`--skip-dns`** neither writes the records nor checks them.

The server's address is the stage's own secret, never config: `GKM_SERVER_IPV4`
(required of a compose stage with a domain) and `GKM_SERVER_IPV6` (optional:
AAAA records). Neither is ever handed to an app. `provider: 'manual'` prints
the records and writes nothing.

## Deploys

Every deploy of a stage on a provider — `gkm deploy` through compose or
Dokploy, and `gkm compose` — runs `verify()` in its readiness check, before
the target is asked anything: `HeadBucket` with
the app's key from the stage's secrets. A bucket that is gone, or a key that is
refused, stops the deploy with `ProvisionedBucketUnreachable`, saying to
deploy with the stage account's credentials, which creates or repairs it.

Providers run at the start of every deploy, whatever the target: a Dokploy
deploy creates a stage's buckets the same way.

Each deploy runs the providers' `ensure()`, the DNS records, then the checks
and the release; `--skip-dns` leaves the records out.

`--allow-dev-services` never stands MinIO in for a bucket a provider backs:
the provider accounts for it.

## Why the deploy

A deployed stage's resources are created by its deploy, every run, so a stage
is never one step behind its code: a new bucket or a new app's host exists by
the time the release that needs it starts. `gkm setup` is a one-time local
step — the local stage's secrets and containers on this machine — and
`gkm setup --stage <deployed>` fails with `SetupIsLocal`, pointing at
`gkm deploy --stage <stage>`.
