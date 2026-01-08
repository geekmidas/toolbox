import type { Meta, StoryObj } from '@storybook/react';
import {
	Bell,
	Pause,
	Play,
	RefreshCw,
	Search,
	Settings,
	Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
	Header,
	HeaderActions,
	HeaderBreadcrumbs,
	HeaderGroup,
	HeaderTitle,
} from './header';

const meta: Meta<typeof Header> = {
	title: 'Layout/Header',
	component: Header,
	tags: ['autodocs'],
	parameters: {
		layout: 'fullscreen',
	},
	decorators: [
		(Story) => (
			<div className="bg-background">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof Header>;

export const Default: Story = {
	render: () => (
		<Header>
			<HeaderTitle>Dashboard</HeaderTitle>
			<HeaderActions>
				<Button variant="ghost" size="icon">
					<Bell className="h-4 w-4" />
				</Button>
				<Button variant="ghost" size="icon">
					<Settings className="h-4 w-4" />
				</Button>
			</HeaderActions>
		</Header>
	),
};

export const WithBreadcrumbs: Story = {
	render: () => (
		<Header>
			<HeaderBreadcrumbs
				items={[
					{ label: 'Dashboard', href: '#' },
					{ label: 'Requests', href: '#' },
					{ label: 'req-12345', current: true },
				]}
			/>
			<HeaderActions>
				<Button variant="outline" size="sm">
					<RefreshCw className="h-4 w-4 mr-2" />
					Refresh
				</Button>
			</HeaderActions>
		</Header>
	),
};

export const WithTitleAndDescription: Story = {
	render: () => (
		<Header>
			<HeaderGroup>
				<HeaderTitle>Requests</HeaderTitle>
				<Badge variant="secondary">156 total</Badge>
			</HeaderGroup>
			<HeaderActions>
				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input placeholder="Filter requests..." className="w-64 pl-8 h-8" />
				</div>
				<Button variant="outline" size="sm">
					<RefreshCw className="h-4 w-4" />
				</Button>
			</HeaderActions>
		</Header>
	),
};

export const MonitoringHeader: Story = {
	render: function MonitoringHeaderExample() {
		const [isLive, setIsLive] = useState(true);

		return (
			<Header>
				<HeaderGroup>
					<Zap className="h-5 w-5 text-accent" />
					<HeaderTitle>Dev Studio</HeaderTitle>
					<Badge variant={isLive ? 'success' : 'secondary'} className="gap-1.5">
						<span
							className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground'}`}
						/>
						{isLive ? 'Live' : 'Paused'}
					</Badge>
				</HeaderGroup>
				<HeaderActions>
					<Button variant="ghost" size="sm" onClick={() => setIsLive(!isLive)}>
						{isLive ? (
							<>
								<Pause className="h-4 w-4 mr-2" />
								Pause
							</>
						) : (
							<>
								<Play className="h-4 w-4 mr-2" />
								Resume
							</>
						)}
					</Button>
					<Button variant="ghost" size="icon">
						<Bell className="h-4 w-4" />
					</Button>
					<Button variant="ghost" size="icon">
						<Settings className="h-4 w-4" />
					</Button>
				</HeaderActions>
			</Header>
		);
	},
};

export const PageHeader: Story = {
	render: () => (
		<Header className="h-auto py-4 flex-col items-start gap-2">
			<HeaderBreadcrumbs
				items={[
					{ label: 'Database', href: '#' },
					{ label: 'Tables', href: '#' },
					{ label: 'users', current: true },
				]}
			/>
			<div className="flex w-full items-center justify-between">
				<HeaderGroup>
					<HeaderTitle>users</HeaderTitle>
					<Badge variant="outline">public</Badge>
				</HeaderGroup>
				<HeaderActions className="ml-0">
					<Button variant="outline" size="sm">
						Export
					</Button>
					<Button size="sm">Insert Row</Button>
				</HeaderActions>
			</div>
		</Header>
	),
};

export const Sticky: Story = {
	render: () => (
		<div className="h-96 overflow-auto">
			<Header sticky>
				<HeaderTitle>Sticky Header</HeaderTitle>
				<HeaderActions>
					<Button variant="ghost" size="icon">
						<Settings className="h-4 w-4" />
					</Button>
				</HeaderActions>
			</Header>
			<div className="p-4 space-y-4">
				{Array.from({ length: 20 }).map((_, i) => (
					<div
						key={i}
						className="h-20 rounded-lg bg-surface border border-border"
					/>
				))}
			</div>
		</div>
	),
};

export const CustomSeparator: Story = {
	render: () => (
		<Header>
			<HeaderBreadcrumbs
				items={[
					{ label: 'Home', href: '#' },
					{ label: 'Projects', href: '#' },
					{ label: 'My Project', current: true },
				]}
				separator="/"
			/>
		</Header>
	),
};
