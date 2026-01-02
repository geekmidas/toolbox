import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'secondary',
        'destructive',
        'outline',
        'success',
        'warning',
        'info',
        'get',
        'post',
        'put',
        'patch',
        'delete',
      ],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    children: 'Badge',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary',
  },
};

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Destructive',
  },
};

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="destructive">Error</Badge>
    </div>
  ),
};

export const HttpMethods: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="get">GET</Badge>
      <Badge variant="post">POST</Badge>
      <Badge variant="put">PUT</Badge>
      <Badge variant="patch">PATCH</Badge>
      <Badge variant="delete">DELETE</Badge>
    </div>
  ),
};

export const StatusCodes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="success">200 OK</Badge>
      <Badge variant="success">201 Created</Badge>
      <Badge variant="info">301 Redirect</Badge>
      <Badge variant="warning">400 Bad Request</Badge>
      <Badge variant="warning">404 Not Found</Badge>
      <Badge variant="destructive">500 Server Error</Badge>
    </div>
  ),
};
