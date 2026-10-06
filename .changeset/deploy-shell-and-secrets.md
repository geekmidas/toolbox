---
'@geekmidas/cli': patch
---

`gkm build`, `gkm docker` and `gkm deploy` run commands as argument arrays and never print the master key

`docker build`, `docker push` and the workspace's turbo build are started with
an argument array and no shell, so a package name, image ref or tag holding
`;`, `$()` or spaces stays one argument. Image refs are checked against
Docker's grammar first and refused as `ImageRefInvalid`; a failing or hung
command raises `CommandFailed` or `CommandTimedOut`.

The master key is no longer printed. Output names it by fingerprint (the first
8 hex characters of its SHA-256). If you copied `GKM_MASTER_KEY` from
`gkm build --stage` output, read it from `.gkm/server/master.key` instead
(owner-only, kept out of the Docker build context); `gkm deploy` still sets it
in the container's runtime environment. `DeployResult.masterKey` is deprecated.

Encrypted credentials reach the image build as a BuildKit secret
(`--secret id=gkm_credentials`) rather than the `GKM_ENCRYPTED_CREDENTIALS` /
`GKM_CREDENTIALS_IV` build args, which `ps` and `docker history` recorded. The
generated multi-stage Dockerfiles read them with
`RUN --mount=type=secret,id=gkm_credentials`; regenerate yours with `gkm docker`.
