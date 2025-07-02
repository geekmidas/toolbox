# @geekmidas/toolbox

> A comprehensive TypeScript monorepo for building modern, type-safe web applications

[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![pnpm Version](https://img.shields.io/badge/pnpm-10.11.0-blue)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![CI](https://github.com/geekmidas/toolbox/actions/workflows/ci.yml/badge.svg)](https://github.com/geekmidas/toolbox/actions/workflows/ci.yml)
[![Publish](https://github.com/geekmidas/toolbox/actions/workflows/publish.yml/badge.svg)](https://github.com/geekmidas/toolbox/actions/workflows/publish.yml)

## 🚀 Overview

**@geekmidas/toolbox** is a collection of TypeScript utilities and frameworks designed to accelerate web application development. Built with modern tooling and best practices, it provides type-safe, developer-friendly APIs for common tasks.

### Key Features

- 🔒 **Type Safety**: Full TypeScript support with runtime validation
- 📦 **Monorepo Structure**: Organized packages with clear separation of concerns
- 🚀 **Modern Tooling**: pnpm, Turbo, tsdown, Biome, and Vitest
- 🎯 **Zero Config**: Sensible defaults with extensive customization options
- 📖 **Well Documented**: Comprehensive docs with practical examples

## 📦 Packages

### [@geekmidas/api](./packages/api)

A powerful REST API framework for building type-safe HTTP endpoints.

- Type-safe endpoint definitions with automatic type inference
- Schema validation using StandardSchema (Zod, Valibot, etc.)
- AWS Lambda support with API Gateway integration
- Built-in error handling and logging
- Automatic OpenAPI schema generation
- Service-oriented architecture with dependency injection

```typescript
import { e } from '@geekmidas/api/server';
import { z } from 'zod';

const endpoint = e
  .get('/users/:id')
  .params(z.object({ id: z.string().uuid() }))
  .output(UserSchema)
  .handle(async ({ params }) => {
    return getUserById(params.id);
  });
```

[Learn more →](./packages/api/README.md)

### [@geekmidas/testkit](./packages/testkit)

A comprehensive testing utility library for creating type-safe test data with database factories.

- Factory pattern implementation for Kysely and Objection.js
- Type-safe builders with automatic schema inference
- Transaction-based test isolation
- Support for complex data relationships
- Built-in database migration utilities
- Batch operations and seeding support

```typescript
import { KyselyFactory } from '@geekmidas/testkit/kysely';

const userBuilder = KyselyFactory.createBuilder<Database, 'users'>({
  table: 'users',
  defaults: async () => ({
    name: 'John Doe',
    email: `user${Date.now()}@example.com`,
    createdAt: new Date(),
  }),
});

// In tests
const user = await factory.insert('user', { name: 'Jane Doe' });
const users = await factory.insertMany(5, 'user');
```

[Learn more →](./packages/testkit/README.md)

### [@geekmidas/envkit](./packages/envkit) *(Coming Soon)*

Type-safe environment configuration parser with Zod validation.

- Type-safe configuration with automatic inference
- Nested configuration structures
- Aggregated error reporting
- Path-based access using lodash utilities

```typescript
import { EnvironmentParser } from '@geekmidas/envkit';
import { z } from 'zod';

const config = new EnvironmentParser(process.env)
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
    database: {
      url: get('DATABASE_URL').string().url()
    }
  }))
  .parse();
```

[Learn more →](./packages/envkit/README.md)

## 🛠️ Getting Started

### Prerequisites

- Node.js ≥ 22.0.0
- pnpm 10.11.0

### Installation

```bash
# Clone the repository
git clone https://github.com/geekmidas/toolbox.git
cd toolbox

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Development

```bash
# Run in development mode with hot reload
pnpm dev

# Type check all packages
pnpm typecheck

# Lint and format code
pnpm lint
pnpm format

# Run tests in watch mode
pnpm test:watch
```

## 📁 Project Structure

```
toolbox/
├── packages/
│   ├── api/          # REST API framework
│   ├── testkit/      # Testing utilities and database factories
│   └── envkit/       # Environment configuration parser
├── turbo.json        # Turbo configuration
├── pnpm-workspace.yaml
├── tsdown.config.ts  # Build configuration
├── vitest.config.ts  # Test configuration
└── biome.json        # Linting and formatting
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Code of Conduct
- Development workflow
- Coding standards
- Pull request process

## 📋 Roadmap

- [ ] Additional validation adapters for @geekmidas/api
- [ ] GraphQL support in @geekmidas/api
- [ ] CLI tools package
- [ ] Database utilities package
- [ ] Authentication helpers

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with ❤️ by the GeekMidas team.

Special thanks to all contributors and the open-source community for the amazing tools that make this project possible.

---

<p align="center">
  <a href="https://github.com/geekmidas/toolbox">GitHub</a> •
  <a href="./packages/api">API Docs</a> •
  <a href="./packages/testkit">TestKit Docs</a> •
  <a href="./packages/envkit">EnvKit Docs</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
