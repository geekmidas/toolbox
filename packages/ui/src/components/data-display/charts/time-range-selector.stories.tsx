import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import {
	createTimeRange,
	type TimeRange,
	TimeRangeSelector,
} from './time-range-selector';

const meta: Meta<typeof TimeRangeSelector> = {
	title: 'Data Display/Charts/TimeRangeSelector',
	component: TimeRangeSelector,
	parameters: {
		layout: 'centered',
	},
};

export default meta;
type Story = StoryObj<typeof TimeRangeSelector>;

function TimeRangeSelectorDemo() {
	const [timeRange, setTimeRange] = useState<TimeRange>(createTimeRange('1h'));

	return (
		<div className="space-y-4">
			<TimeRangeSelector value={timeRange} onChange={setTimeRange} />
			<div className="text-sm text-muted-foreground">
				<p>Preset: {timeRange.preset}</p>
				<p>Start: {timeRange.start.toISOString()}</p>
				<p>End: {timeRange.end.toISOString()}</p>
			</div>
		</div>
	);
}

export const Default: Story = {
	render: () => <TimeRangeSelectorDemo />,
};

export const WithCustomPresets: Story = {
	args: {
		value: createTimeRange('24h'),
		onChange: () => {},
		presets: [
			{ label: '15m', value: '1h' as const },
			{ label: '1h', value: '1h' as const },
			{ label: '4h', value: '6h' as const },
			{ label: '12h', value: '24h' as const },
		],
	},
};

export const WithoutIcon: Story = {
	args: {
		value: createTimeRange('6h'),
		onChange: () => {},
		showIcon: false,
	},
};
