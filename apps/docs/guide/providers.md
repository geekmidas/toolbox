# Providers

A construct says a thing exists: `new ObjectStorage('Uploads')` is a bucket.
What backs it on a deployed stage is the stage's to say, under
`deploy.<kind>.<stage>` — the key is the construct's manifest kind. A stage
that names a **provider** has gkm create the backing resource in the stage's
own account and write its connection value into the stage's secrets, where
every deploy reads it as if you had set it by hand.

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
gkm setup --stage production --dry-run   # what would be created or changed
gkm setup --stage production             # create it, fix drift, write the keys
gkm deploy --stage production            # checks the bucket answers its key
```

The first kind is `objects` — what `ObjectStorage` and `FileServer` produce.
`cache` and `email` take the same `deploy.<kind>.<stage>` shape as their
providers arrive.

## What a provider is

| Part | What it is |
|---|---|
| provisioning credentials | What *creates* the resource — the stage account's admin credentials. Read only by `gkm setup`, never given to an app. |
| `ensure()` | Idempotent find-or-create. Tries a good, deterministic name; records what it made in the stage's state; puts back what drifted. **Never deletes.** |
| runtime credentials | The keys it writes into the stage's secrets for the apps: for `s3`, the bucket's URL with a key scoped to it. |
| `verify()` | The cheap check every deploy runs: for `s3`, `HeadBucket` with the key in the stage's secrets. |

## `deploy.objects.<stage>`

| Value | Meaning |
|---|---|
| `'external'` (or nothing) | Today's behaviour. Each bucket's `<ID>_URL` and each file server's `<ID>_URL` are set in the stage's secrets by you — S3, R2, any S3-compatible store. A missing key fails `validate` with `ExternalServicesNotConfigured`. |
| `{ provider: 's3', region?, versioning? }` | `gkm setup --stage <stage>` creates and maintains the buckets in the stage's AWS account and writes their keys. |
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

The provider provisions in the stage's AWS account, found the way the SSM and
Secrets Manager stores find it:

1. `--profile <name>` — that profile alone, even with other keys exported;
2. `AWS_PROFILE`, else `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
   (`AWS_SESSION_TOKEN`) — in CI, what `aws-actions/configure-aws-credentials`
   exports;
3. the SDK's default chain — `~/.aws`'s default profile, SSO, a role.

**None of them**: the provider acts as `external`. `gkm setup` says which keys
are yours to set and what to supply to have them created, and nothing fails.
A deploy missing a key fails as it always did, with
`ExternalServicesNotConfigured` — and the line for each key it lacks says
`gkm setup --stage <stage>` writes it, and with which credentials.

The apps never see the provisioning credentials: only the bucket's own key, in
its URL.

## `--dry-run`

```bash
gkm setup --stage production --dry-run
```

Reads the account (with the provisioning credentials) and the stage's state,
and prints each change it would make — `would create in eu-west-1 — bucket
acme-shop-production-uploads`, `would set CORS for https://shop.example.com`,
… Nothing is created, and nothing is written to the stage's secrets or state.
No secrets are generated for the stage either.

## Rotating a key

```bash
gkm setup --stage production --rotate-keys   # a second key, written to the secrets
gkm deploy --stage production                # the apps start using it
gkm setup --stage production                 # the old key is deleted
```

1. `--rotate-keys` creates a second key for each user, writes it into the
   stage's secrets in place of the first, records the old one in the state,
   and tells you to deploy. Both keys work.
2. The next `gkm setup --stage <stage>` **after a deploy** (the stage's state
   records when it was last deployed) deletes the old key. Before that deploy,
   it leaves the old key alone and says so.
3. `--retire-old-keys` deletes it at once, without waiting for a deploy.

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

`gkm setup --stage <stage>` also points a compose stage's public hosts at its
server, through the DNS provider each root domain names in `dns`:

```ts
// gkm.config.ts
domains: { production: 'shop.example.com' },
dns: { 'example.com': { provider: 'godaddy' } },
deploy: { default: 'compose' },
```

```bash
gkm secrets:set GKM_SERVER_IPV4 '203.0.113.10' --stage production
gkm setup --stage production --dry-run   # the exact records, and what changes
gkm setup --stage production             # write them
```

It is a provider like the others in every way that matters:

- **Provisioning credentials** come from the machine running setup — the DNS
  provider's token (`GODADDY_API_TOKEN`, `gkm login --provider godaddy`), an
  AWS profile for Route53. The server never holds them. With none, setup says
  how to supply them and prints the records to create by hand.
- **Idempotent.** A record that already has the right value is left alone; one
  with another value is replaced, printing `old → new`. Only the A, AAAA and
  CNAME records of the stack's own hosts are ever written.
- **`--dry-run`** prints each record — name, type, value, TTL — and whether it
  would be created, updated or left alone, and writes nothing.
- **`verify()`** is the deploy's DNS check: every host must resolve to the
  server before the stack starts (see the
  [compose guide](./compose.md#the-dns-check)).

The server's address is the stage's own secret, never config: `GKM_SERVER_IPV4`
(required of a compose stage with a domain) and `GKM_SERVER_IPV6` (optional:
AAAA records). Neither is ever handed to an app. `provider: 'manual'` prints
the records and writes nothing.

## Deploys

Every deploy of a stage on a provider — `gkm deploy` through compose or
Dokploy, and `gkm compose` — runs `verify()` in `validate`: `HeadBucket` with
the app's key from the stage's secrets. A bucket that is gone, or a key that is
refused, stops the deploy with `ProvisionedBucketUnreachable`, saying to run
`gkm setup --stage <stage>`.

`--allow-dev-services` never stands MinIO in for a bucket a provider backs:
the provider accounts for it.

## Why `gkm setup`

`gkm setup` converges a stage on what its constructs declare. On the local
stage that is containers and generated secrets on this machine; on a deployed
stage it is the providers, in the stage's account. A deployed stage's
infrastructure is not on this machine, so `gkm setup --stage <deployed>`
starts no container.
