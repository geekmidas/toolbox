import type { Meta, StoryObj } from '@storybook/react';
import { StatusDistributionChart } from './status-distribution-chart';

const meta: Meta<typeof StatusDistributionChart> = {
	title: 'Data Display/Charts/StatusDistributionChart',
	component: StatusDistributionChart,
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
type Story = StoryObj<typeof StatusDistributionChart>;

export const Default: Story = {
	args: {
		data: {
			'2xx': 850,
			'3xx': 50,
			'4xx': 75,
			'5xx': 25,
		},
	},
};

export const MostlySuccess: Story = {
	args: {
		data: {
			'2xx': 980,
			'3xx': 10,
			'4xx': 8,
			'5xx': 2,
		},
	},
};

export const HighErrorRate: Story = {
	args: {
		data: {
			'2xx': 500,
			'3xx': 20,
			'4xx': 200,
			'5xx': 280,
		},
	},
};

export const Empty: Story = {
	args: {
		data: {
			'2xx': 0,
			'3xx': 0,
			'4xx': 0,
			'5xx': 0,
		},
	},
};
