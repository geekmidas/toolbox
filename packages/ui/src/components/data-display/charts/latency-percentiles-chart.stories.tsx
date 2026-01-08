import type { Meta, StoryObj } from '@storybook/react';
import { LatencyPercentilesChart } from './latency-percentiles-chart';

const meta: Meta<typeof LatencyPercentilesChart> = {
	title: 'Data Display/Charts/LatencyPercentilesChart',
	component: LatencyPercentilesChart,
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
type Story = StoryObj<typeof LatencyPercentilesChart>;

export const Default: Story = {
	args: {
		p50: 45,
		p95: 120,
		p99: 250,
	},
};

export const FastResponses: Story = {
	args: {
		p50: 5,
		p95: 15,
		p99: 30,
	},
};

export const SlowResponses: Story = {
	args: {
		p50: 500,
		p95: 2000,
		p99: 5000,
	},
};

export const Empty: Story = {
	args: {
		p50: 0,
		p95: 0,
		p99: 0,
	},
};
