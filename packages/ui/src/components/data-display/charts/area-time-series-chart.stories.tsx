import type { Meta, StoryObj } from '@storybook/react';
import { subMinutes } from 'date-fns';
import { AreaTimeSeriesChart } from './area-time-series-chart';

const meta: Meta<typeof AreaTimeSeriesChart> = {
	title: 'Data Display/Charts/AreaTimeSeriesChart',
	component: AreaTimeSeriesChart,
	parameters: {
		layout: 'centered',
	},
	decorators: [
		(Story) => (
			<div className="w-[600px]">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof AreaTimeSeriesChart>;

const now = Date.now();
const generateData = (count: number, baseValue: number, variance: number) =>
	Array.from({ length: count }, (_, i) => ({
		timestamp: subMinutes(now, count - i).getTime(),
		value: Math.round(baseValue + (Math.random() - 0.5) * variance),
	}));

const generateDataWithErrors = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		timestamp: subMinutes(now, count - i).getTime(),
		value: Math.round(50 + (Math.random() - 0.5) * 30),
		secondaryValue: Math.round(Math.random() * 5),
	}));

export const RequestVolume: Story = {
	args: {
		data: generateData(30, 100, 60),
		primaryLabel: 'Requests',
		primaryColor: 'blue',
	},
};

export const WithErrors: Story = {
	args: {
		data: generateDataWithErrors(30),
		primaryLabel: 'Requests',
		secondaryLabel: 'Errors',
		primaryColor: 'blue',
		secondaryColor: 'red',
	},
};

export const LowTraffic: Story = {
	args: {
		data: generateData(30, 10, 8),
		primaryLabel: 'Requests',
		primaryColor: 'emerald',
	},
};

export const Empty: Story = {
	args: {
		data: [],
		primaryLabel: 'Requests',
	},
};
