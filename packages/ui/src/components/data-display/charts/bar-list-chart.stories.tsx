import type { Meta, StoryObj } from '@storybook/react';
import { BarListChart } from './bar-list-chart';

const meta: Meta<typeof BarListChart> = {
  title: 'Data Display/Charts/BarListChart',
  component: BarListChart,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof BarListChart>;

export const Endpoints: Story = {
  args: {
    data: [
      { name: 'GET /api/users', value: 1250 },
      { name: 'POST /api/auth/login', value: 890 },
      { name: 'GET /api/products', value: 654 },
      { name: 'PUT /api/users/:id', value: 234 },
      { name: 'DELETE /api/sessions', value: 123 },
    ],
  },
};

export const Categories: Story = {
  args: {
    data: [
      { name: 'Electronics', value: 5420 },
      { name: 'Clothing', value: 3210 },
      { name: 'Books', value: 2100 },
      { name: 'Home & Garden', value: 1540 },
      { name: 'Sports', value: 890 },
    ],
    valueFormatter: (v) => `$${v.toLocaleString()}`,
  },
};

export const WithClick: Story = {
  args: {
    data: [
      { name: 'Item A', value: 100 },
      { name: 'Item B', value: 80 },
      { name: 'Item C', value: 60 },
    ],
    onItemClick: (item) => alert(`Clicked: ${item.name}`),
  },
};

export const Empty: Story = {
  args: {
    data: [],
    emptyMessage: 'No endpoints recorded yet',
  },
};
