import type {
  GeneratedFile,
  TemplateConfig,
  TemplateOptions,
} from '../templates/index.js';

/**
 * Generate environment files (.env, .env.example, .env.development, .env.test, .gitignore)
 */
export function generateEnvFiles(
  options: TemplateOptions,
  template: TemplateConfig,
): GeneratedFile[] {
  const { database } = options;
  const isServerless = template.name === 'serverless';
  const hasWorker = template.name === 'worker';

  // Build base env content
  let baseEnv = `# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
`;

  if (isServerless) {
    baseEnv = `# AWS
STAGE=dev
AWS_REGION=us-east-1
LOG_LEVEL=info
`;
  }

  if (database) {
    baseEnv += `
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
`;
  }

  if (hasWorker) {
    baseEnv += `
# Message Queue
RABBITMQ_URL=amqp://localhost:5672
`;
  }

  baseEnv += `
# Authentication
JWT_SECRET=your-secret-key-change-in-production
`;

  // Development env
  let devEnv = `# Development Environment
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
`;

  if (isServerless) {
    devEnv = `# Development Environment
STAGE=dev
AWS_REGION=us-east-1
LOG_LEVEL=debug
`;
  }

  if (database) {
    devEnv += `
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mydb_dev
`;
  }

  if (hasWorker) {
    devEnv += `
# Message Queue
RABBITMQ_URL=amqp://localhost:5672
`;
  }

  devEnv += `
# Authentication
JWT_SECRET=dev-secret-not-for-production
`;

  // Test env
  let testEnv = `# Test Environment
NODE_ENV=test
PORT=3001
LOG_LEVEL=error
`;

  if (isServerless) {
    testEnv = `# Test Environment
STAGE=test
AWS_REGION=us-east-1
LOG_LEVEL=error
`;
  }

  if (database) {
    testEnv += `
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mydb_test
`;
  }

  if (hasWorker) {
    testEnv += `
# Message Queue
RABBITMQ_URL=amqp://localhost:5672
`;
  }

  testEnv += `
# Authentication
JWT_SECRET=test-secret-not-for-production
`;

  const files: GeneratedFile[] = [
    {
      path: '.env.example',
      content: baseEnv,
    },
    {
      path: '.env',
      content: baseEnv,
    },
    {
      path: '.env.development',
      content: devEnv,
    },
    {
      path: '.env.test',
      content: testEnv,
    },
  ];

  // Only add .gitignore for non-monorepo (monorepo has it at root)
  if (!options.monorepo) {
    const gitignore = `# Dependencies
node_modules/

# Build output
dist/
.gkm/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# Test coverage
coverage/

# TypeScript cache
*.tsbuildinfo
`;
    files.push({
      path: '.gitignore',
      content: gitignore,
    });
  }

  return files;
}
