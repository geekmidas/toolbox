# Build Package

Build a specific package or all packages in the monorepo.

## Usage

When the user asks to build a package, compile it using the build system.

## Instructions

1. Identify the package name from the user's request
2. For a specific package: `pnpm build (-F or --filter) [package-name]`
3. For all packages: `pnpm build`
4. Check for build errors and report them clearly

## Examples

- "Build the constructs package" → `pnpm build -F constructs`
- "Build the cli" → `pnpm build --filter cli`
- "Build everything" → `pnpm build`
- "Rebuild auth package" → `pnpm build -F auth`

## Package Names

Available packages:
- api
- auth
- cache
- cli
- constructs
- db
- emailkit
- envkit
- events
- logger
- schema
- services
- storage
- testkit
- rate-limit
- errors

## Build System

- Uses **tsdown** for building
- Generates ESM (`.mjs`) and CJS (`.cjs`) outputs
- Outputs to `dist/` directory in each package
- Type definitions (`.d.ts`) are also generated

## Notes

- Build is required before publishing to npm
- Check for TypeScript errors during build
- Build may be required after making changes to package exports
- `-F` is shorthand for `--filter`
