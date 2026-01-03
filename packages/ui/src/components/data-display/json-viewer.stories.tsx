import type { Meta, StoryObj } from '@storybook/react';
import { JsonViewer } from './json-viewer';

const meta: Meta<typeof JsonViewer> = {
  title: 'Data Display/JsonViewer',
  component: JsonViewer,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof JsonViewer>;

const simpleData = {
  name: 'John Doe',
  age: 30,
  active: true,
  email: null,
};

export const Simple: Story = {
  args: {
    data: simpleData,
    className: 'w-96',
  },
};

const nestedData = {
  user: {
    id: 'usr_123',
    name: 'John Doe',
    email: 'john@example.com',
    metadata: {
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: '2024-01-20T15:45:00Z',
      preferences: {
        theme: 'dark',
        notifications: true,
        language: 'en',
      },
    },
  },
  roles: ['admin', 'user'],
  permissions: {
    read: true,
    write: true,
    delete: false,
  },
};

export const Nested: Story = {
  args: {
    data: nestedData,
    className: 'w-[500px]',
  },
};

const apiResponse = {
  status: 200,
  headers: {
    'content-type': 'application/json',
    'x-request-id': 'req_abc123',
  },
  body: {
    success: true,
    data: {
      users: [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
        { id: 3, name: 'Charlie', email: 'charlie@example.com' },
      ],
      pagination: {
        page: 1,
        perPage: 10,
        total: 3,
        hasMore: false,
      },
    },
    meta: {
      requestTime: 45,
      cached: false,
    },
  },
};

export const ApiResponse: Story = {
  args: {
    data: apiResponse,
    className: 'w-[600px]',
    expandDepth: 3,
  },
};

export const Collapsed: Story = {
  args: {
    data: nestedData,
    className: 'w-[500px]',
    defaultExpanded: false,
  },
};

export const ExpandDepth1: Story = {
  args: {
    data: nestedData,
    className: 'w-[500px]',
    expandDepth: 1,
  },
};

export const WithArray: Story = {
  args: {
    data: {
      items: [
        { id: 1, name: 'Item 1', price: 9.99 },
        { id: 2, name: 'Item 2', price: 19.99 },
        { id: 3, name: 'Item 3', price: 29.99 },
      ],
      total: 59.97,
      currency: 'USD',
    },
    className: 'w-[500px]',
  },
};

export const EmptyValues: Story = {
  args: {
    data: {
      nullValue: null,
      emptyString: '',
      emptyArray: [],
      emptyObject: {},
      zero: 0,
      falsy: false,
    },
    className: 'w-96',
  },
};

export const NoCopyButton: Story = {
  args: {
    data: simpleData,
    className: 'w-96',
    copyable: false,
  },
};

export const LargeDataset: Story = {
  args: {
    data: {
      records: Array.from({ length: 10 }, (_, i) => ({
        id: `record_${i + 1}`,
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        level: ['info', 'warn', 'error'][i % 3],
        message: `Log message ${i + 1}`,
        metadata: {
          source: 'api-server',
          requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
        },
      })),
    },
    className: 'w-[600px] max-h-96',
    expandDepth: 2,
  },
};

export const RequestDetails: Story = {
  render: () => (
    <div className="space-y-4 w-[600px]">
      <div>
        <h4 className="text-sm font-medium mb-2 text-foreground">
          Request Headers
        </h4>
        <JsonViewer
          data={{
            'content-type': 'application/json',
            authorization: 'Bearer ***redacted***',
            'user-agent': 'Mozilla/5.0',
            'x-request-id': 'req_abc123',
          }}
        />
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2 text-foreground">
          Request Body
        </h4>
        <JsonViewer
          data={{
            action: 'create_user',
            payload: {
              email: 'user@example.com',
              name: 'New User',
              role: 'member',
            },
          }}
        />
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2 text-foreground">
          Response Body
        </h4>
        <JsonViewer
          data={{
            success: true,
            user: {
              id: 'usr_new123',
              email: 'user@example.com',
              name: 'New User',
              createdAt: '2024-01-20T10:30:00Z',
            },
          }}
        />
      </div>
    </div>
  ),
};
