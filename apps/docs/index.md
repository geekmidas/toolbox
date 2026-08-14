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
  - title: Type-Safe APIs
    details: Build REST APIs with full TypeScript type inference using @geekmidas/constructs
  - title: Testing Utilities
    details: Comprehensive testing factories and utilities with @geekmidas/testkit
  - title: Environment Config
    details: Type-safe environment configuration parsing with @geekmidas/envkit
---

::: warning YOU ARE READING THE IN-DEVELOPMENT DOCS
This is the `main` line, where the **constructs paradigm** is being introduced —
everything becomes a construct, and the `function → resource` dependency edge
becomes the single primitive. See the [design RFC](/guide/constructs-paradigm).

The pages below still describe the **current** API. They are rewritten as each
phase lands, so treat anything outside the RFC as v9 documentation until its
page says otherwise.

**For released documentation, switch to [v9](https://geekmidas.github.io/toolbox/).**
:::