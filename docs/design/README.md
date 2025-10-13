# Design Documents

This directory contains design documents, architectural decision records (ADRs), and technical planning documents for the @geekmidas/toolbox project.

## Documents

### Active Planning

- **[Package Refactoring Plan](./package-refactoring-plan.md)** - Plan to extract `@geekmidas/constructs` and enhance `@geekmidas/schema`
  - Status: Planning
  - Impact: High - Major architectural change
  - Timeline: TBD

- **[Environment Variable Detection](./environment-variable-detection.md)** - Automatic detection of environment variables used by constructs
  - Status: Draft
  - Impact: Medium - New feature for build process
  - Timeline: TBD
  - Dependencies: May be affected by package refactoring

## Document Status

- **Draft**: Initial proposal, open for discussion
- **Planning**: Approved approach, detailed planning in progress
- **In Progress**: Implementation has started
- **Implemented**: Feature is complete and released
- **Deprecated**: Document is outdated or proposal was rejected

## Contributing

When creating new design documents:

1. Use the appropriate template (if available)
2. Include these sections:
   - **Status**: Current state of the proposal
   - **Overview**: High-level summary
   - **Problem Statement**: What problem does this solve?
   - **Proposed Solution**: How will we solve it?
   - **Alternatives Considered**: What other options were evaluated?
   - **Implementation Plan**: Step-by-step plan
   - **Testing Strategy**: How will we verify it works?
   - **Impact Analysis**: What will this affect?

3. Name files using kebab-case: `feature-name.md`
4. Update this README with a link to your document

## Related Documentation

- [Project Structure Guide](../../apps/docs/guide/project-structure.md)
- [API Reference](../../apps/docs/api/)
- [Package Documentation](../../apps/docs/packages/)

## Questions?

If you have questions about these design documents, please:
- Open an issue in the repository
- Discuss in team meetings
- Comment on the relevant pull request
