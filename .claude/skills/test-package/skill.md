# Test Package

Run tests for a specific package in the monorepo.

## Usage

When the user asks to test a package, run the tests for that specific package.

## Instructions

1. Identify the package name from the user's request
2. Run tests using `pnpm test:once packages/[package-name]/src`
3. If tests fail, analyze the output and report the failures
4. For specific test files, use the file path relative to the project root

## Examples

- "Test the constructs package" → `pnpm test:once packages/constructs/src`
- "Test the auth package" → `pnpm test:once packages/auth/src`
- "Test EndpointBuilder" → `pnpm test:once packages/constructs/src/endpoints/__tests__/EndpointBuilder.spec.ts`

## Package Names

Available packages in `packages/` directory:
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

## Notes

- Use `test:once` for single run (CI mode)
- Use `test` for watch mode if explicitly requested
- Check for test output and report failures clearly
- Tests are located in `__tests__/` directories or as `.spec.ts` files
