import type { Meta, StoryObj } from '@storybook/react';
import { Activity, Database, FileText, Users } from 'lucide-react';
import {
	EmptyState,
	NoData,
	NoResults,
	NotFound,
	ServerError,
} from './empty-state';

const meta: Meta<typeof EmptyState> = {
	title: 'Feedback/EmptyState',
	component: EmptyState,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
	},
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
	args: {
		icon: <Activity className="h-full w-full" />,
		title: 'No requests yet',
		description: 'Start making requests to see them appear here.',
	},
};

export const WithAction: Story = {
	args: {
		icon: <Users className="h-full w-full" />,
		title: 'No users found',
		description: "You haven't added any users yet.",
		action: {
			label: 'Add User',
			onClick: () => alert('Add user clicked'),
		},
	},
};

export const WithBothActions: Story = {
	args: {
		icon: <Database className="h-full w-full" />,
		title: 'No tables found',
		description: 'Create a new table or import from an existing database.',
		action: {
			label: 'Create Table',
			onClick: () => alert('Create clicked'),
		},
		secondaryAction: {
			label: 'Import',
			onClick: () => alert('Import clicked'),
		},
	},
};

export const Sizes: Story = {
	render: () => (
		<div className="flex gap-8">
			<div className="w-48 border border-border rounded-md">
				<EmptyState
					size="sm"
					icon={<FileText className="h-full w-full" />}
					title="No logs"
					description="No logs found"
				/>
			</div>
			<div className="w-64 border border-border rounded-md">
				<EmptyState
					size="md"
					icon={<FileText className="h-full w-full" />}
					title="No logs"
					description="No logs found for this period"
				/>
			</div>
			<div className="w-80 border border-border rounded-md">
				<EmptyState
					size="lg"
					icon={<FileText className="h-full w-full" />}
					title="No logs"
					description="No logs found for this period. Try adjusting your filters."
				/>
			</div>
		</div>
	),
};

export const Presets: Story = {
	render: () => (
		<div className="grid grid-cols-2 gap-4">
			<div className="border border-border rounded-md">
				<NoData description="No data to display" />
			</div>
			<div className="border border-border rounded-md">
				<NoResults searchTerm="test query" />
			</div>
			<div className="border border-border rounded-md">
				<NotFound />
			</div>
			<div className="border border-border rounded-md">
				<ServerError />
			</div>
		</div>
	),
};

export const NoDataPreset: StoryObj<typeof NoData> = {
	render: () => (
		<NoData
			title="No requests"
			description="Start making requests to see them here."
			action={{
				label: 'Learn More',
				onClick: () => alert('Learn more clicked'),
			}}
		/>
	),
};

export const NoResultsPreset: StoryObj<typeof NoResults> = {
	render: () => (
		<NoResults
			searchTerm="api/users"
			action={{
				label: 'Clear Search',
				onClick: () => alert('Clear clicked'),
			}}
		/>
	),
};

export const NotFoundPreset: StoryObj<typeof NotFound> = {
	render: () => (
		<NotFound
			action={{
				label: 'Go Home',
				onClick: () => alert('Go home clicked'),
			}}
			secondaryAction={{
				label: 'Go Back',
				onClick: () => alert('Go back clicked'),
			}}
		/>
	),
};

export const ServerErrorPreset: StoryObj<typeof ServerError> = {
	render: () => (
		<ServerError
			action={{
				label: 'Try Again',
				onClick: () => alert('Retry clicked'),
			}}
		/>
	),
};

export const InTable: Story = {
	render: () => (
		<div className="w-[600px] border border-border rounded-md">
			<div className="flex items-center justify-between p-4 border-b border-border">
				<h3 className="font-semibold">Recent Requests</h3>
				<button className="text-sm text-muted-foreground hover:text-foreground">
					Refresh
				</button>
			</div>
			<div className="h-64 flex items-center justify-center">
				<EmptyState
					icon={<Activity className="h-full w-full" />}
					title="No requests yet"
					description="Make a request to your API to see it appear here."
					action={{
						label: 'View Documentation',
						onClick: () => alert('View docs'),
					}}
				/>
			</div>
		</div>
	),
};

export const InCard: Story = {
	render: () => (
		<div className="w-80 bg-surface border border-border rounded-lg overflow-hidden">
			<div className="p-4 border-b border-border">
				<h3 className="font-semibold">Exceptions</h3>
			</div>
			<NoData
				size="sm"
				title="No exceptions"
				description="Your application is running smoothly!"
			/>
		</div>
	),
};

export const CustomContent: Story = {
	render: () => (
		<EmptyState
			icon={<Database className="h-full w-full" />}
			title="Connect your database"
		>
			<p className="text-sm text-muted-foreground max-w-sm">
				Connect to a PostgreSQL database to start browsing tables and running
				queries.
			</p>
			<div className="mt-4 flex gap-2">
				<button className="px-3 py-1.5 text-sm rounded-md bg-accent text-accent-foreground">
					Connect PostgreSQL
				</button>
				<button className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-surface-hover">
					Other Databases
				</button>
			</div>
		</EmptyState>
	),
};
