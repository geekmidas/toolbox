import type { Meta, StoryObj } from '@storybook/react';
import { CodeBlock } from './code-block';

const meta: Meta<typeof CodeBlock> = {
  title: 'Components/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    language: {
      control: 'select',
      options: ['typescript', 'javascript', 'json', 'bash', 'sql', 'jsx', 'tsx'],
    },
    showLineNumbers: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof CodeBlock>;

const typescriptCode = `import { Hono } from 'hono';
import { Studio } from '@geekmidas/studio';
import { InMemoryStorage } from '@geekmidas/telescope';

const app = new Hono();

const studio = new Studio({
  monitoring: {
    storage: new InMemoryStorage(),
    recordBody: true,
    maxBodySize: 64 * 1024,
  },
});

app.route('/__studio', createStudioApp(studio));

export default app;`;

export const TypeScript: Story = {
  args: {
    code: typescriptCode,
    language: 'typescript',
  },
};

export const WithLineNumbers: Story = {
  args: {
    code: typescriptCode,
    language: 'typescript',
    showLineNumbers: true,
  },
};

const jsonCode = `{
  "id": "req_abc123",
  "method": "POST",
  "path": "/api/users",
  "status": 201,
  "duration": 145,
  "request": {
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer ***"
    },
    "body": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  },
  "response": {
    "id": "user_xyz789",
    "created": true
  }
}`;

export const JSON: Story = {
  args: {
    code: jsonCode,
    language: 'json',
  },
};

const jsxCode = `function UserCard({ user }) {
  return (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>{user.name}</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant={user.active ? 'success' : 'secondary'}>
          {user.active ? 'Active' : 'Inactive'}
        </Badge>
      </CardContent>
      <CardFooter>
        <Button variant="outline">Edit</Button>
        <Button variant="destructive">Delete</Button>
      </CardFooter>
    </Card>
  );
}`;

export const JSX: Story = {
  args: {
    code: jsxCode,
    language: 'jsx',
  },
};

const bashCode = `# Install dependencies
pnpm add @geekmidas/studio @geekmidas/telescope

# Start development server
pnpm dev --port 3000

# Build for production
pnpm build --provider aws-apigatewayv1`;

export const Bash: Story = {
  args: {
    code: bashCode,
    language: 'bash',
  },
};

const sqlCode = `SELECT
  u.id,
  u.name,
  u.email,
  COUNT(o.id) as order_count,
  SUM(o.total) as total_spent
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.id, u.name, u.email
ORDER BY total_spent DESC
LIMIT 10;`;

export const SQL: Story = {
  args: {
    code: sqlCode,
    language: 'sql',
  },
};

const endpointCode = `import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const createUser = e
  .post('/users')
  .body(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    role: z.enum(['admin', 'user']).default('user'),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
    createdAt: z.string(),
  }))
  .handle(async ({ body, services }) => {
    const user = await services.db
      .insertInto('users')
      .values(body)
      .returningAll()
      .executeTakeFirstOrThrow();

    return user;
  });`;

export const EndpointExample: Story = {
  args: {
    code: endpointCode,
    language: 'typescript',
    showLineNumbers: true,
  },
};

export const Compact: Story = {
  args: {
    code: 'const greeting = "Hello, World!";',
    language: 'typescript',
  },
};
