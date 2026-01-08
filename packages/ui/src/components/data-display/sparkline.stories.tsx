import type { Meta, StoryObj } from '@storybook/react';
import { Activity, AlertCircle, Clock, Users, Zap } from 'lucide-react';
import { MetricCard, SparkBar, Sparkline } from './sparkline';

const meta: Meta<typeof Sparkline> = {
	title: 'Data Display/Sparkline',
	component: Sparkline,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
	},
};

export default meta;
type Story = StoryObj<typeof Sparkline>;

const sampleData = [10, 25, 15, 30, 22, 35, 28, 40, 32, 45, 38, 50];
const trendingUp = [10, 12, 15, 18, 22, 28, 35, 42, 50, 58, 65, 72];
const trendingDown = [72, 65, 58, 50, 42, 35, 28, 22, 18, 15, 12, 10];
const volatile = [20, 45, 15, 60, 30, 55, 25, 70, 35, 50, 40, 65];

export const Default: Story = {
	args: {
		data: sampleData,
		width: 150,
		height: 40,
	},
};

export const Filled: Story = {
	args: {
		data: sampleData,
		width: 150,
		height: 40,
		filled: true,
	},
};

export const WithDots: Story = {
	args: {
		data: sampleData,
		width: 150,
		height: 40,
		showDots: true,
	},
};

export const Straight: Story = {
	args: {
		data: sampleData,
		width: 150,
		height: 40,
		curved: false,
	},
};

export const TrendingUp: Story = {
	args: {
		data: trendingUp,
		width: 150,
		height: 40,
		filled: true,
		className: 'text-green-500',
	},
};

export const TrendingDown: Story = {
	args: {
		data: trendingDown,
		width: 150,
		height: 40,
		filled: true,
		className: 'text-red-500',
	},
};

export const Volatile: Story = {
	args: {
		data: volatile,
		width: 150,
		height: 40,
		filled: true,
		className: 'text-amber-500',
	},
};

export const CustomColors: Story = {
	render: () => (
		<div className="flex gap-4">
			<Sparkline data={sampleData} color="#3b82f6" filled />
			<Sparkline data={sampleData} color="#22c55e" filled />
			<Sparkline data={sampleData} color="#f59e0b" filled />
			<Sparkline data={sampleData} color="#ef4444" filled />
			<Sparkline data={sampleData} color="#8b5cf6" filled />
		</div>
	),
};

export const Sizes: Story = {
	render: () => (
		<div className="flex flex-col gap-4 items-start">
			<Sparkline data={sampleData} width={80} height={24} filled />
			<Sparkline data={sampleData} width={120} height={32} filled />
			<Sparkline data={sampleData} width={200} height={48} filled />
			<Sparkline data={sampleData} width={300} height={64} filled />
		</div>
	),
};

// SparkBar Stories
export const Bar: StoryObj<typeof SparkBar> = {
	render: () => <SparkBar data={sampleData} width={150} height={40} />,
};

export const BarWithGap: StoryObj<typeof SparkBar> = {
	render: () => (
		<div className="flex flex-col gap-4">
			<SparkBar data={sampleData} width={150} height={40} gap={0.1} />
			<SparkBar data={sampleData} width={150} height={40} gap={0.3} />
			<SparkBar data={sampleData} width={150} height={40} gap={0.5} />
		</div>
	),
};

export const BarColors: StoryObj<typeof SparkBar> = {
	render: () => (
		<div className="flex gap-4">
			<SparkBar data={trendingUp} color="#22c55e" />
			<SparkBar data={volatile} color="#f59e0b" />
			<SparkBar data={trendingDown} color="#ef4444" />
		</div>
	),
};

// MetricCard Stories
export const MetricCardDefault: StoryObj<typeof MetricCard> = {
	render: () => (
		<MetricCard
			title="Total Requests"
			value="1,234"
			description="from last hour"
			sparklineData={sampleData}
			icon={<Activity className="h-4 w-4" />}
		/>
	),
};

export const MetricCardTrendUp: StoryObj<typeof MetricCard> = {
	render: () => (
		<MetricCard
			title="Active Users"
			value="2,345"
			trendValue="+12.5%"
			description="from yesterday"
			trend="up"
			sparklineData={trendingUp}
			icon={<Users className="h-4 w-4" />}
		/>
	),
};

export const MetricCardTrendDown: StoryObj<typeof MetricCard> = {
	render: () => (
		<MetricCard
			title="Error Rate"
			value="2.4%"
			trendValue="-0.3%"
			description="from last week"
			trend="down"
			sparklineData={trendingDown}
			icon={<AlertCircle className="h-4 w-4" />}
		/>
	),
};

export const MetricCardGrid: StoryObj<typeof MetricCard> = {
	render: () => (
		<div className="grid grid-cols-2 gap-4 w-[600px]">
			<MetricCard
				title="Total Requests"
				value="12,345"
				trendValue="+8.2%"
				description="from last hour"
				trend="up"
				sparklineData={trendingUp}
				icon={<Activity className="h-4 w-4" />}
			/>
			<MetricCard
				title="Avg Response Time"
				value="45ms"
				trendValue="-5ms"
				description="from last hour"
				trend="up"
				sparklineData={trendingDown}
				icon={<Clock className="h-4 w-4" />}
			/>
			<MetricCard
				title="Error Rate"
				value="0.5%"
				trendValue="+0.1%"
				description="from last hour"
				trend="down"
				sparklineData={volatile}
				icon={<AlertCircle className="h-4 w-4" />}
			/>
			<MetricCard
				title="Active Services"
				value="12"
				description="all healthy"
				trend="neutral"
				sparklineData={sampleData}
				icon={<Zap className="h-4 w-4" />}
			/>
		</div>
	),
};

export const MetricCardNoSparkline: StoryObj<typeof MetricCard> = {
	render: () => (
		<MetricCard
			title="Database Connections"
			value="45"
			description="of 100 max"
			icon={<Activity className="h-4 w-4" />}
		/>
	),
};

export const AllVariants: Story = {
	render: () => (
		<div className="space-y-8">
			<div>
				<h3 className="text-sm font-medium mb-2">Sparklines</h3>
				<div className="flex gap-4 items-center">
					<Sparkline data={sampleData} />
					<Sparkline data={sampleData} filled />
					<Sparkline data={sampleData} showDots />
					<Sparkline data={sampleData} curved={false} />
				</div>
			</div>

			<div>
				<h3 className="text-sm font-medium mb-2">Spark Bars</h3>
				<div className="flex gap-4 items-center">
					<SparkBar data={sampleData} />
					<SparkBar data={sampleData} gap={0.3} />
					<SparkBar data={sampleData} radius={0} />
				</div>
			</div>

			<div>
				<h3 className="text-sm font-medium mb-2">Metric Cards</h3>
				<div className="grid grid-cols-3 gap-4">
					<MetricCard
						title="Metric 1"
						value="1,234"
						trend="up"
						trendValue="+5%"
						sparklineData={trendingUp}
					/>
					<MetricCard
						title="Metric 2"
						value="567"
						trend="down"
						trendValue="-2%"
						sparklineData={trendingDown}
					/>
					<MetricCard
						title="Metric 3"
						value="890"
						trend="neutral"
						sparklineData={volatile}
					/>
				</div>
			</div>
		</div>
	),
};
