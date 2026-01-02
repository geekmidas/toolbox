import type { Meta, StoryObj } from '@storybook/react';
import { Badge, getMethodBadgeVariant, getStatusBadgeVariant } from '.';

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'success',
        'warning',
        'error',
        'info',
        'method-get',
        'method-post',
        'method-put',
        'method-patch',
        'method-delete',
      ],
      description: 'The visual style variant of the badge',
    },
    size: {
      control: 'select',
      options: ['sm', 'md'],
      description: 'The size of the badge',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    variant: 'default',
    children: 'Default',
  },
};

export const Success: Story = {
  args: {
    variant: 'success',
    children: 'Active',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    children: 'Pending',
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    children: 'Failed',
  },
};

export const Info: Story = {
  args: {
    variant: 'info',
    children: 'Processing',
  },
};

export const HttpMethods: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Badge variant="method-get">GET</Badge>
      <Badge variant="method-post">POST</Badge>
      <Badge variant="method-put">PUT</Badge>
      <Badge variant="method-patch">PATCH</Badge>
      <Badge variant="method-delete">DELETE</Badge>
    </div>
  ),
};

export const StatusCodes: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Badge variant={getStatusBadgeVariant(200)}>200 OK</Badge>
      <Badge variant={getStatusBadgeVariant(201)}>201 Created</Badge>
      <Badge variant={getStatusBadgeVariant(301)}>301 Redirect</Badge>
      <Badge variant={getStatusBadgeVariant(400)}>400 Bad Request</Badge>
      <Badge variant={getStatusBadgeVariant(404)}>404 Not Found</Badge>
      <Badge variant={getStatusBadgeVariant(500)}>500 Server Error</Badge>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex gap-2 items-center">
      <Badge size="sm">Small</Badge>
      <Badge size="md">Medium</Badge>
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      <Badge variant="default">Default</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="error">Error</Badge>
      <Badge variant="info">Info</Badge>
    </div>
  ),
};

export const MethodHelper: Story = {
  render: () => (
    <div className="flex gap-2 flex-wrap">
      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => (
        <Badge key={method} variant={getMethodBadgeVariant(method)}>
          {method}
        </Badge>
      ))}
    </div>
  ),
};
