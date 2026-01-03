import type { Meta, StoryObj } from '@storybook/react';
import {
  HttpMethodBadge,
  HttpStatusBadge,
  LogLevelBadge,
  StatusBadge,
} from './status-badge';

const meta: Meta<typeof StatusBadge> = {
  title: 'Feedback/StatusBadge',
  component: StatusBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const HttpStatus: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status={200} />
      <StatusBadge status={201} />
      <StatusBadge status={301} />
      <StatusBadge status={400} />
      <StatusBadge status={401} />
      <StatusBadge status={404} />
      <StatusBadge status={500} />
      <StatusBadge status={502} />
    </div>
  ),
};

export const HttpMethods: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge method="GET" />
      <StatusBadge method="POST" />
      <StatusBadge method="PUT" />
      <StatusBadge method="PATCH" />
      <StatusBadge method="DELETE" />
      <StatusBadge method="HEAD" />
      <StatusBadge method="OPTIONS" />
    </div>
  ),
};

export const LogLevels: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge logLevel="trace" />
      <StatusBadge logLevel="debug" />
      <StatusBadge logLevel="info" />
      <StatusBadge logLevel="warn" />
      <StatusBadge logLevel="error" />
      <StatusBadge logLevel="fatal" />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <StatusBadge status={200} size="sm" />
      <StatusBadge status={200} size="md" />
      <StatusBadge status={200} size="lg" />
    </div>
  ),
};

export const WithPulse: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status={200} pulse />
      <StatusBadge method="GET" pulse />
      <StatusBadge logLevel="info" pulse />
    </div>
  ),
};

export const CustomColor: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge color="#8b5cf6">Custom</StatusBadge>
      <StatusBadge color="#ec4899">Pink</StatusBadge>
      <StatusBadge color="#06b6d4">Cyan</StatusBadge>
    </div>
  ),
};

export const TypedBadges: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium mb-2">HttpStatusBadge</h4>
        <div className="flex gap-2">
          <HttpStatusBadge code={200} />
          <HttpStatusBadge code={404} />
          <HttpStatusBadge code={500} />
        </div>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2">HttpMethodBadge</h4>
        <div className="flex gap-2">
          <HttpMethodBadge method="GET" />
          <HttpMethodBadge method="POST" />
          <HttpMethodBadge method="DELETE" />
        </div>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2">LogLevelBadge</h4>
        <div className="flex gap-2">
          <LogLevelBadge level="info" />
          <LogLevelBadge level="warn" />
          <LogLevelBadge level="error" />
        </div>
      </div>
    </div>
  ),
};

export const InContext: Story = {
  render: () => (
    <div className="space-y-4 w-96">
      <div className="flex items-center justify-between p-3 rounded-md bg-surface border border-border">
        <div className="flex items-center gap-2">
          <StatusBadge method="GET" size="sm" />
          <span className="font-mono text-sm">/api/users</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={200} size="sm" />
          <span className="text-xs text-muted-foreground">45ms</span>
        </div>
      </div>
      <div className="flex items-center justify-between p-3 rounded-md bg-surface border border-border">
        <div className="flex items-center gap-2">
          <StatusBadge method="POST" size="sm" />
          <span className="font-mono text-sm">/api/users</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={201} size="sm" />
          <span className="text-xs text-muted-foreground">120ms</span>
        </div>
      </div>
      <div className="flex items-center justify-between p-3 rounded-md bg-surface border border-border">
        <div className="flex items-center gap-2">
          <StatusBadge method="DELETE" size="sm" />
          <span className="font-mono text-sm">/api/users/123</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={404} size="sm" />
          <span className="text-xs text-muted-foreground">15ms</span>
        </div>
      </div>
    </div>
  ),
};

export const LogEntries: Story = {
  render: () => (
    <div className="space-y-2 w-[500px]">
      {[
        {
          level: 'info',
          message: 'Server started on port 3000',
          time: '10:30:45',
        },
        {
          level: 'debug',
          message: 'Database connection established',
          time: '10:30:46',
        },
        {
          level: 'warn',
          message: 'Rate limit threshold reached',
          time: '10:31:20',
        },
        {
          level: 'error',
          message: 'Failed to connect to Redis',
          time: '10:31:45',
        },
      ].map((log, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-2 rounded-md bg-surface border border-border"
        >
          <StatusBadge logLevel={log.level as any} size="sm" className="w-14" />
          <span className="flex-1 text-sm">{log.message}</span>
          <span className="text-xs text-muted-foreground">{log.time}</span>
        </div>
      ))}
    </div>
  ),
};
