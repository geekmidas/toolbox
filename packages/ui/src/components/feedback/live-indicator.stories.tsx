import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ConnectionStatus, LiveIndicator } from './live-indicator';

const meta: Meta<typeof LiveIndicator> = {
	title: 'Feedback/LiveIndicator',
	component: LiveIndicator,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
	},
};

export default meta;
type Story = StoryObj<typeof LiveIndicator>;

export const Default: Story = {
	args: {
		live: true,
	},
};

export const Paused: Story = {
	args: {
		live: false,
	},
};

export const Sizes: Story = {
	render: () => (
		<div className="flex items-center gap-4">
			<LiveIndicator size="sm" live />
			<LiveIndicator size="md" live />
			<LiveIndicator size="lg" live />
		</div>
	),
};

export const Variants: Story = {
	render: () => (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-4">
				<LiveIndicator variant="default" live />
				<LiveIndicator variant="default" live={false} />
			</div>
			<div className="flex items-center gap-4">
				<LiveIndicator variant="solid" live />
				<LiveIndicator variant="solid" live={false} />
			</div>
		</div>
	),
};

export const Toggleable: Story = {
	render: function ToggleableIndicator() {
		const [live, setLive] = useState(true);

		return <LiveIndicator live={live} toggleable onLiveToggle={setLive} />;
	},
};

export const CustomLabels: Story = {
	render: () => (
		<div className="flex flex-col gap-4">
			<LiveIndicator live liveLabel="Recording" pausedLabel="Stopped" />
			<LiveIndicator live={false} liveLabel="Recording" pausedLabel="Stopped" />
			<LiveIndicator live liveLabel="Streaming" pausedLabel="Offline" />
		</div>
	),
};

export const CustomColor: Story = {
	render: () => (
		<div className="flex flex-col gap-4">
			<LiveIndicator live liveColor="#3b82f6" liveLabel="Syncing" />
			<LiveIndicator live liveColor="#8b5cf6" liveLabel="Processing" />
			<LiveIndicator live liveColor="#ec4899" liveLabel="Active" />
		</div>
	),
};

// ConnectionStatus Stories
export const ConnectionStatuses: StoryObj<typeof ConnectionStatus> = {
	render: () => (
		<div className="flex flex-col gap-4">
			<ConnectionStatus status="connected" />
			<ConnectionStatus status="connecting" />
			<ConnectionStatus status="disconnected" />
			<ConnectionStatus status="error" />
		</div>
	),
};

export const ConnectionStatusSizes: StoryObj<typeof ConnectionStatus> = {
	render: () => (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-4">
				<ConnectionStatus status="connected" size="sm" />
				<ConnectionStatus status="connected" size="md" />
				<ConnectionStatus status="connected" size="lg" />
			</div>
			<div className="flex items-center gap-4">
				<ConnectionStatus status="error" size="sm" />
				<ConnectionStatus status="error" size="md" />
				<ConnectionStatus status="error" size="lg" />
			</div>
		</div>
	),
};

export const ConnectionStatusNoLabel: StoryObj<typeof ConnectionStatus> = {
	render: () => (
		<div className="flex items-center gap-4">
			<ConnectionStatus status="connected" showLabel={false} />
			<ConnectionStatus status="connecting" showLabel={false} />
			<ConnectionStatus status="disconnected" showLabel={false} />
			<ConnectionStatus status="error" showLabel={false} />
		</div>
	),
};

export const InHeader: Story = {
	render: function HeaderExample() {
		const [live, setLive] = useState(true);

		return (
			<div className="w-96 flex items-center justify-between p-4 bg-surface border border-border rounded-md">
				<div className="flex items-center gap-2">
					<span className="font-semibold">Dev Studio</span>
				</div>
				<LiveIndicator
					live={live}
					toggleable
					onLiveToggle={setLive}
					variant="solid"
					size="sm"
				/>
			</div>
		);
	},
};

export const WebSocketStatus: StoryObj<typeof ConnectionStatus> = {
	render: function WebSocketExample() {
		const [status, setStatus] = useState<
			'connected' | 'connecting' | 'disconnected' | 'error'
		>('connected');

		return (
			<div className="space-y-4">
				<div className="p-4 bg-surface border border-border rounded-md">
					<div className="flex items-center justify-between">
						<span className="text-sm font-medium">WebSocket</span>
						<ConnectionStatus status={status} size="sm" />
					</div>
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-500"
						onClick={() => setStatus('connected')}
					>
						Connected
					</button>
					<button
						type="button"
						className="px-2 py-1 text-xs rounded bg-amber-500/20 text-amber-500"
						onClick={() => setStatus('connecting')}
					>
						Connecting
					</button>
					<button
						type="button"
						className="px-2 py-1 text-xs rounded bg-gray-500/20 text-gray-500"
						onClick={() => setStatus('disconnected')}
					>
						Disconnected
					</button>
					<button
						type="button"
						className="px-2 py-1 text-xs rounded bg-red-500/20 text-red-500"
						onClick={() => setStatus('error')}
					>
						Error
					</button>
				</div>
			</div>
		);
	},
};
