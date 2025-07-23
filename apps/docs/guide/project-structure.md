# Project Structure

The @geekmidas/toolbox monorepo is organized as follows:

```
toolbox/
├── packages/           # Core packages
│   ├── api/           # REST API framework
│   ├── testkit/       # Testing utilities
│   └── envkit/        # Environment config parser
├── apps/              # Applications
│   └── docs/          # VitePress documentation
├── turbo.json         # Turbo configuration
├── pnpm-workspace.yaml
├── tsdown.config.ts   # Build configuration
├── vitest.config.ts   # Test configuration
└── biome.json         # Linting and formatting
```

## Package Organization

Each package follows a consistent structure:

```
packages/[name]/
├── src/               # Source code
│   ├── index.ts      # Main entry point
│   └── ...           # Package-specific modules
├── tests/            # Test files
├── package.json      # Package manifest
├── tsconfig.json     # TypeScript config
└── README.md         # Package documentation
```

## Build System

The project uses:
- **tsdown** for building TypeScript packages (ESM + CJS)
- **Turbo** for monorepo task orchestration
- **Biome** for linting and formatting

## Development Workflow

1. Install dependencies: `pnpm install`
2. Build all packages: `pnpm build`
3. Run tests: `pnpm test`
4. Check code quality: `pnpm lint`