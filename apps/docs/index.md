---
layout: home

hero:
  name: "@geekmidas/toolbox"
  text: "Modern TypeScript Utilities"
  tagline: A comprehensive monorepo for building type-safe web applications
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/geekmidas/toolbox

features:
  - title: Everything Is a Construct
    details: A database, bucket, cache, or credential is one declaration. The container, the environment, the client, and the cloud resource all derive from it.
  - title: One Edge, Three Derivations
    details: .dependsOn([uploads]) gives a handler its client, its environment, and exactly the cloud access it named — and nothing else.
  - title: Type-Safe APIs
    details: Build REST APIs with full TypeScript type inference using @geekmidas/constructs
  - title: Zero Hand-Wired Infra
    details: gkm dev reconciles the containers your constructs imply. Nothing lists postgres anywhere.
---

::: warning YOU ARE READING THE IN-DEVELOPMENT DOCS
This is the `main` line, where the **constructs paradigm** lands: everything
becomes a construct, and the `function → resource` dependency edge becomes the
single primitive. The [design RFC](/guide/constructs-paradigm) argues it in
full.

Rewritten for the new model: [Getting Started](/guide/getting-started),
[Project Structure](/guide/project-structure),
[@geekmidas/constructs](/packages/constructs),
[@geekmidas/cli](/packages/cli), [Development Server](/guide/dev-server),
[Workspaces](/guide/workspaces), [Testing](/guide/testing), and
[Deployment](/guide/deployment).

Still describing the pre-constructs shape:
[Fullstack Init](/guide/fullstack-init) — its auth app has not declared its
half yet — and [@geekmidas/cloud](/packages/cloud), the hand-written stack.

**For released documentation, switch to [v9](https://geekmidas.github.io/toolbox/).**
:::
