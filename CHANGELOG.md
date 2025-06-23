# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo setup with pnpm workspaces
- TypeScript configuration with Node 22 support
- Build system using tsdown for CommonJS and ESM outputs
- Testing infrastructure with Vitest
- Linting and formatting with Biome
- Turbo for monorepo task orchestration

### Packages

#### @geekmidas/api (v0.0.1) - 2025-01-06

##### Added
- Core REST API framework with type-safe endpoint definitions
- Fluent API design pattern for building endpoints
- Schema validation using StandardSchema specification
- Support for Zod, Valibot, and other validation libraries
- AWS Lambda support via `AWSApiGatewayV1EndpointAdaptor`
- Comprehensive HTTP error classes for all status codes
- Service-oriented architecture with `HermodService` base class
- Built-in structured logging with context propagation
- Automatic OpenAPI schema generation
- Middleware-like composition through method chaining
- Route grouping and prefixing support
- Session management and authorization helpers

##### Examples
- Basic endpoint creation
- Error handling patterns
- Service implementation
- AWS Lambda integration
- Advanced endpoint configuration

#### @geekmidas/envkit (v0.0.1) - 2025-01-06 [Private]

##### Added
- Type-safe environment configuration parser
- Zod schema validation for robust type checking
- Support for nested configuration structures
- Aggregated error reporting for better debugging
- Path-based access using lodash utilities
- Automatic type inference from schemas
- Flexible getter API with chaining support

##### Examples
- Basic usage patterns
- Validation scenarios
- Error handling
- Complex nested configurations
- Schema composition

## Version Guidelines

### Version Format
We use Semantic Versioning: `MAJOR.MINOR.PATCH`

- **MAJOR**: Incompatible API changes
- **MINOR**: Backwards-compatible functionality additions
- **PATCH**: Backwards-compatible bug fixes

### Pre-release Versions
- Alpha: `0.0.1-alpha.1`
- Beta: `0.0.1-beta.1`
- Release Candidate: `0.0.1-rc.1`

### Version Bumping
Each package is versioned independently:
- Breaking changes in one package don't affect others
- Packages can have different version numbers
- Dependencies between packages use workspace protocol

---

[Unreleased]: https://github.com/geekmidas/toolbox/compare/v0.0.1...HEAD