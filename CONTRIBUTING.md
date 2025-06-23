# Contributing to @geekmidas/toolbox

Thank you for your interest in contributing to @geekmidas/toolbox! We value all contributions, whether they're bug reports, feature requests, documentation improvements, or code contributions.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Community](#community)

## 📜 Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:

- **Be respectful**: Treat everyone with respect and kindness
- **Be inclusive**: Welcome and support people of all backgrounds and identities
- **Be collaborative**: Work together to resolve conflicts and assume good intentions
- **Be professional**: Harassment and inappropriate behavior are not tolerated

## 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/toolbox.git
   cd toolbox
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/geekmidas/toolbox.git
   ```

## 🛠️ Development Setup

### Prerequisites

- Node.js ≥ 22.0.0
- pnpm 10.11.0
- Git

### Initial Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests to ensure everything works
pnpm test

# Set up git hooks (optional but recommended)
pnpm prepare
```

### IDE Setup

We recommend using Visual Studio Code with the following extensions:
- [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) - For linting and formatting
- [TypeScript](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-typescript-next) - Enhanced TypeScript support
- [Vitest](https://marketplace.visualstudio.com/items?itemName=vitest.explorer) - Test explorer integration

## 🔄 Development Workflow

### 1. Create a Feature Branch

```bash
# Update main branch
git checkout main
git pull upstream main

# Create a new branch
git checkout -b feature/your-feature-name
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation improvements
- `refactor/` - Code refactoring
- `test/` - Test improvements
- `chore/` - Maintenance tasks

### 2. Make Your Changes

```bash
# Run in development mode
pnpm dev

# Run specific package in dev mode
pnpm --filter @geekmidas/api dev
```

### 3. Test Your Changes

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @geekmidas/api test

# Run tests in watch mode
pnpm test:watch

# Run type checking
pnpm typecheck
```

### 4. Lint and Format

```bash
# Check linting
pnpm lint

# Auto-fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check
```

## 📏 Coding Standards

### TypeScript Guidelines

- Use TypeScript strict mode
- Prefer interfaces over type aliases for object types
- Use explicit return types for public APIs
- Avoid `any` - use `unknown` if type is truly unknown
- Document complex types with JSDoc comments

### Code Style

- Follow the existing code style (enforced by Biome)
- Use meaningful variable and function names
- Keep functions small and focused
- Write self-documenting code
- Add comments only when necessary

### File Organization

```typescript
// 1. Imports (external first, then internal)
import { z } from 'zod';
import type { Context } from './types.js';

// 2. Type definitions
export interface UserConfig {
  name: string;
  email: string;
}

// 3. Constants
const DEFAULT_TIMEOUT = 5000;

// 4. Main implementation
export class UserService {
  // Implementation
}

// 5. Helper functions
function validateEmail(email: string): boolean {
  // Implementation
}
```

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test additions or corrections
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Other changes that don't modify src or test files

Examples:
```bash
feat(api): add support for custom error handlers
fix(envkit): handle undefined environment variables correctly
docs: update contributing guide with new standards
```

## 🧪 Testing

### Writing Tests

- Write tests for all new features
- Maintain or improve code coverage
- Use descriptive test names
- Follow the AAA pattern (Arrange, Act, Assert)
- Test edge cases and error conditions

### Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService();
  });

  describe('createUser', () => {
    it('should create a user with valid data', () => {
      // Arrange
      const userData = { name: 'John', email: 'john@example.com' };

      // Act
      const user = service.createUser(userData);

      // Assert
      expect(user).toMatchObject(userData);
      expect(user.id).toBeDefined();
    });

    it('should throw error for invalid email', () => {
      // Test implementation
    });
  });
});
```

## 🔀 Pull Request Process

### 1. Before Creating a PR

- Ensure all tests pass: `pnpm test`
- Check types: `pnpm typecheck`
- Fix linting issues: `pnpm lint:fix`
- Format code: `pnpm format`
- Update documentation if needed
- Add/update tests for your changes

### 2. Creating the PR

- Push your branch to your fork
- Create a PR from your fork to the main repository
- Use a clear, descriptive title
- Fill out the PR template completely
- Link related issues

### 3. PR Description Template

```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tests pass locally
- [ ] Added new tests
- [ ] Updated existing tests

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### 4. Review Process

- Maintainers will review your PR
- Address feedback promptly
- Keep the PR up to date with main branch
- Be patient - reviews take time

## 🐛 Reporting Issues

### Before Creating an Issue

1. Search existing issues to avoid duplicates
2. Check if the issue is already fixed in the latest version
3. Gather relevant information about the problem

### Creating an Issue

Use our issue templates:
- **Bug Report**: For reporting bugs
- **Feature Request**: For suggesting new features
- **Documentation**: For documentation improvements

Include:
- Clear, descriptive title
- Detailed description
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Environment details (Node version, OS, etc.)
- Code examples or error messages

## 👥 Community

### Getting Help

- Check the [documentation](./README.md)
- Search [existing issues](https://github.com/geekmidas/toolbox/issues)
- Ask questions in [discussions](https://github.com/geekmidas/toolbox/discussions)

### Staying Updated

- Watch the repository for updates
- Follow our [changelog](./CHANGELOG.md)
- Join community discussions

## 🎉 Recognition

We value all contributions! Contributors will be:
- Listed in our contributors section
- Mentioned in release notes
- Given credit in relevant documentation

Thank you for contributing to @geekmidas/toolbox! 🚀