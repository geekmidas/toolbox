# @geekmidas/testkit

## 1.0.6

### Patch Changes

- 🐛 [`b8a17e3`](https://github.com/geekmidas/toolbox/commit/b8a17e33de415a5d749297f7840564e824609a92) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix global zod registry and fix this reference on test extensions

## 1.0.5

### Patch Changes

- 🐛 [`184c254`](https://github.com/geekmidas/toolbox/commit/184c2547a674d37c48948a9922c947ca98ff1f17) Thanks [@geekmidas](https://github.com/geekmidas)! - Fix script parsing

## 1.0.4

### Patch Changes

- ✨ [`7815080`](https://github.com/geekmidas/toolbox/commit/781508030df7f67881f5e79349338f62b35ed684) Thanks [@geekmidas](https://github.com/geekmidas)! - Add after create hook for init scripts

## 1.0.3

### Patch Changes

- ✨ [`e99f8cb`](https://github.com/geekmidas/toolbox/commit/e99f8cbb95fa5b818d94ee99b308c2ac0b239e0b) Thanks [@geekmidas](https://github.com/geekmidas)! - Add initialization scripts for postgres

## 1.0.2

### Patch Changes

- ✨ [`83a24de`](https://github.com/geekmidas/toolbox/commit/83a24de902b3fadd98444cab552ecd84f32b6661) Thanks [@geekmidas](https://github.com/geekmidas)! - Add pg-boss event publisher/subscriber, CLI setup and upgrade commands, and secrets sync via AWS SSM
  - ✨ **@geekmidas/events**: Add pg-boss backend for event publishing and subscribing with connection string support
  - ✨ **@geekmidas/cli**: Add `gkm setup` command for dev environment initialization, `gkm upgrade` command with workspace detection, and secrets push/pull via AWS SSM Parameter Store
  - 🐛 **@geekmidas/testkit**: Fix database creation race condition in PostgresMigrator
  - ✨ **@geekmidas/constructs**: Add integration tests for pg-boss with HonoEndpoint

## 1.0.1

### Patch Changes

- ✨ [`3b6d7d9`](https://github.com/geekmidas/toolbox/commit/3b6d7d9ed41dc08675395d937248a8ab754af9e1) Thanks [@geekmidas](https://github.com/geekmidas)! - Add state provider configuration to workspace config

## 1.0.0

### Major Changes

- [`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8) Thanks [@geekmidas](https://github.com/geekmidas)! - Version 1 Stable release

### Patch Changes

- Updated dependencies [[`ff7b115`](https://github.com/geekmidas/toolbox/commit/ff7b11599f60f84ac6cdc73714c853ecf786b2e8)]:
  - @geekmidas/envkit@1.0.0
  - @geekmidas/logger@1.0.0
