import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

const meta: Meta<typeof Table> = {
  title: 'Components/Table',
  component: Table,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Table>;

const invoices = [
  { invoice: 'INV001', status: 'Paid', method: 'Credit Card', amount: '$250.00' },
  { invoice: 'INV002', status: 'Pending', method: 'PayPal', amount: '$150.00' },
  { invoice: 'INV003', status: 'Unpaid', method: 'Bank Transfer', amount: '$350.00' },
  { invoice: 'INV004', status: 'Paid', method: 'Credit Card', amount: '$450.00' },
  { invoice: 'INV005', status: 'Paid', method: 'PayPal', amount: '$550.00' },
];

export const Default: Story = {
  render: () => (
    <Table>
      <TableCaption>A list of your recent invoices.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[100px]">Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.invoice}>
            <TableCell className="font-medium">{invoice.invoice}</TableCell>
            <TableCell>{invoice.status}</TableCell>
            <TableCell>{invoice.method}</TableCell>
            <TableCell className="text-right">{invoice.amount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Total</TableCell>
          <TableCell className="text-right">$1,750.00</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
};

const requests = [
  { method: 'GET', path: '/api/users', status: 200, duration: '45ms' },
  { method: 'POST', path: '/api/users', status: 201, duration: '120ms' },
  { method: 'GET', path: '/api/products', status: 200, duration: '89ms' },
  { method: 'PUT', path: '/api/users/1', status: 200, duration: '156ms' },
  { method: 'DELETE', path: '/api/users/2', status: 404, duration: '23ms' },
  { method: 'PATCH', path: '/api/orders/5', status: 500, duration: '340ms' },
];

export const RequestsTable: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[100px]">Method</TableHead>
          <TableHead>Path</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((req, i) => (
          <TableRow key={i}>
            <TableCell>
              <Badge
                variant={
                  req.method.toLowerCase() as
                    | 'get'
                    | 'post'
                    | 'put'
                    | 'patch'
                    | 'delete'
                }
              >
                {req.method}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-sm">{req.path}</TableCell>
            <TableCell>
              <Badge
                variant={
                  req.status >= 500
                    ? 'destructive'
                    : req.status >= 400
                      ? 'warning'
                      : 'success'
                }
              >
                {req.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {req.duration}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

const logs = [
  { level: 'info', message: 'Application started', timestamp: '12:00:01' },
  { level: 'debug', message: 'Connected to database', timestamp: '12:00:02' },
  { level: 'warn', message: 'Cache miss for key: user_123', timestamp: '12:00:05' },
  { level: 'error', message: 'Failed to process request', timestamp: '12:00:08' },
  { level: 'info', message: 'Request completed', timestamp: '12:00:10' },
];

export const LogsTable: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[80px]">Level</TableHead>
          <TableHead>Message</TableHead>
          <TableHead className="text-right w-[100px]">Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log, i) => (
          <TableRow key={i}>
            <TableCell>
              <Badge
                variant={
                  log.level === 'error'
                    ? 'destructive'
                    : log.level === 'warn'
                      ? 'warning'
                      : log.level === 'debug'
                        ? 'secondary'
                        : 'info'
                }
              >
                {log.level}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-sm">{log.message}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {log.timestamp}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const Simple: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>John Doe</TableCell>
          <TableCell>john@example.com</TableCell>
          <TableCell>Admin</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Jane Smith</TableCell>
          <TableCell>jane@example.com</TableCell>
          <TableCell>User</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Bob Johnson</TableCell>
          <TableCell>bob@example.com</TableCell>
          <TableCell>User</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
