import type { Meta, StoryObj } from '@storybook/react';
import {
  AlertCircle,
  CheckCircle,
  Database,
  Globe,
  Server,
  Zap,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDescription,
  TimelineIndicator,
  TimelineItem,
  TimelineTime,
  TimelineTitle,
} from './timeline';

const meta: Meta<typeof Timeline> = {
  title: 'Data Display/Timeline',
  component: Timeline,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Timeline>;

export const Default: Story = {
  render: () => (
    <Timeline className="w-80">
      <TimelineItem>
        <TimelineIndicator variant="success" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Request received</TimelineTitle>
          <TimelineDescription>GET /api/users - 200 OK</TimelineDescription>
          <TimelineTime>10:30:45.123</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="info" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Database query</TimelineTitle>
          <TimelineDescription>SELECT * FROM users - 45ms</TimelineDescription>
          <TimelineTime>10:30:45.168</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="success" />
        <TimelineContent>
          <TimelineTitle>Response sent</TimelineTitle>
          <TimelineDescription>200 OK - 50ms total</TimelineDescription>
          <TimelineTime>10:30:45.173</TimelineTime>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <Timeline className="w-96">
      <TimelineItem>
        <TimelineIndicator variant="primary" size="lg">
          <Globe className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Request received</TimelineTitle>
          <TimelineDescription>
            POST /api/users - Creating new user
          </TimelineDescription>
          <TimelineTime>10:30:45.123</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="info" size="lg">
          <Database className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Database transaction</TimelineTitle>
          <TimelineDescription>INSERT INTO users... - 12ms</TimelineDescription>
          <TimelineTime>10:30:45.135</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="warning" size="lg">
          <Server className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Cache invalidation</TimelineTitle>
          <TimelineDescription>Clearing user cache - 3ms</TimelineDescription>
          <TimelineTime>10:30:45.147</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="success" size="lg">
          <CheckCircle className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineContent>
          <TimelineTitle>Response sent</TimelineTitle>
          <TimelineDescription>201 Created - 30ms total</TimelineDescription>
          <TimelineTime>10:30:45.153</TimelineTime>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  ),
};

export const RequestTrace: Story = {
  render: () => (
    <Timeline className="w-[500px]">
      <TimelineItem>
        <TimelineIndicator variant="success" size="lg">
          <Globe className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <div className="flex items-center gap-2">
            <TimelineTitle>HTTP Request</TimelineTitle>
            <Badge variant="get">GET</Badge>
          </div>
          <TimelineDescription>/api/products/123</TimelineDescription>
          <div className="mt-2 p-2 rounded bg-surface border border-border text-xs font-mono">
            <div>Host: api.example.com</div>
            <div>User-Agent: Mozilla/5.0</div>
          </div>
          <TimelineTime>0ms</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="info" size="lg">
          <Database className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <div className="flex items-center gap-2">
            <TimelineTitle>Database Query</TimelineTitle>
            <Badge variant="secondary">PostgreSQL</Badge>
          </div>
          <TimelineDescription>
            SELECT * FROM products WHERE id = $1
          </TimelineDescription>
          <TimelineTime>+12ms</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="primary" size="lg">
          <Zap className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineConnector />
        <TimelineContent>
          <div className="flex items-center gap-2">
            <TimelineTitle>Cache Hit</TimelineTitle>
            <Badge variant="success">HIT</Badge>
          </div>
          <TimelineDescription>Retrieved from Redis cache</TimelineDescription>
          <TimelineTime>+15ms</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="success" size="lg">
          <CheckCircle className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineContent>
          <div className="flex items-center gap-2">
            <TimelineTitle>Response</TimelineTitle>
            <Badge variant="success">200</Badge>
          </div>
          <TimelineDescription>
            Returned product data - 18ms total
          </TimelineDescription>
          <TimelineTime>+18ms</TimelineTime>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  ),
};

export const WithErrors: Story = {
  render: () => (
    <Timeline className="w-96">
      <TimelineItem>
        <TimelineIndicator variant="success" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Request received</TimelineTitle>
          <TimelineDescription>POST /api/users</TimelineDescription>
          <TimelineTime>10:30:45.123</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="info" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Validation started</TimelineTitle>
          <TimelineDescription>Checking request body</TimelineDescription>
          <TimelineTime>10:30:45.125</TimelineTime>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="error" size="lg">
          <AlertCircle className="h-3 w-3 text-background" />
        </TimelineIndicator>
        <TimelineContent>
          <div className="flex items-center gap-2">
            <TimelineTitle className="text-red-400">
              Validation failed
            </TimelineTitle>
          </div>
          <TimelineDescription>Email format is invalid</TimelineDescription>
          <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            ValidationError: Invalid email format
          </div>
          <TimelineTime>10:30:45.126</TimelineTime>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  ),
};

export const Compact: Story = {
  render: () => (
    <Timeline className="w-80">
      <TimelineItem>
        <TimelineIndicator size="sm" variant="success" />
        <TimelineConnector />
        <TimelineContent className="pt-0">
          <TimelineTime>10:30:45</TimelineTime>
          <TimelineDescription>Request received</TimelineDescription>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator size="sm" variant="info" />
        <TimelineConnector />
        <TimelineContent className="pt-0">
          <TimelineTime>10:30:45</TimelineTime>
          <TimelineDescription>Database query - 12ms</TimelineDescription>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator size="sm" variant="info" />
        <TimelineConnector />
        <TimelineContent className="pt-0">
          <TimelineTime>10:30:45</TimelineTime>
          <TimelineDescription>Cache lookup - 2ms</TimelineDescription>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator size="sm" variant="success" />
        <TimelineContent className="pt-0">
          <TimelineTime>10:30:45</TimelineTime>
          <TimelineDescription>Response sent - 15ms</TimelineDescription>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  ),
};

export const ActivityLog: Story = {
  render: () => (
    <Timeline className="w-96">
      <TimelineItem>
        <TimelineIndicator variant="primary" />
        <TimelineConnector />
        <TimelineContent>
          <div className="flex items-center justify-between">
            <TimelineTitle>User created</TimelineTitle>
            <TimelineTime>2 hours ago</TimelineTime>
          </div>
          <TimelineDescription>
            John Doe (john@example.com) was created
          </TimelineDescription>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="warning" />
        <TimelineConnector />
        <TimelineContent>
          <div className="flex items-center justify-between">
            <TimelineTitle>Role updated</TimelineTitle>
            <TimelineTime>1 hour ago</TimelineTime>
          </div>
          <TimelineDescription>
            Changed role from "User" to "Admin"
          </TimelineDescription>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="info" />
        <TimelineConnector />
        <TimelineContent>
          <div className="flex items-center justify-between">
            <TimelineTitle>Password reset</TimelineTitle>
            <TimelineTime>30 min ago</TimelineTime>
          </div>
          <TimelineDescription>Password reset email sent</TimelineDescription>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="success" />
        <TimelineContent>
          <div className="flex items-center justify-between">
            <TimelineTitle>Login successful</TimelineTitle>
            <TimelineTime>5 min ago</TimelineTime>
          </div>
          <TimelineDescription>Logged in from 192.168.1.1</TimelineDescription>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  ),
};

export const VariantShowcase: Story = {
  render: () => (
    <Timeline className="w-64">
      <TimelineItem>
        <TimelineIndicator variant="default" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Default</TimelineTitle>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="primary" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Primary</TimelineTitle>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="success" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Success</TimelineTitle>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="warning" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Warning</TimelineTitle>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="error" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Error</TimelineTitle>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="info" />
        <TimelineConnector />
        <TimelineContent>
          <TimelineTitle>Info</TimelineTitle>
        </TimelineContent>
      </TimelineItem>
      <TimelineItem>
        <TimelineIndicator variant="muted" />
        <TimelineContent>
          <TimelineTitle>Muted</TimelineTitle>
        </TimelineContent>
      </TimelineItem>
    </Timeline>
  ),
};
