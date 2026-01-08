import type { Meta, StoryObj } from '@storybook/react';
import { Separator } from './separator';

const meta: Meta<typeof Separator> = {
	title: 'Components/Separator',
	component: Separator,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
	},
};

export default meta;
type Story = StoryObj<typeof Separator>;

export const Horizontal: Story = {
	render: () => (
		<div className="w-[300px]">
			<div className="space-y-1">
				<h4 className="text-sm font-medium leading-none">Radix Primitives</h4>
				<p className="text-sm text-muted-foreground">
					An open-source UI component library.
				</p>
			</div>
			<Separator className="my-4" />
			<div className="flex h-5 items-center space-x-4 text-sm">
				<div>Blog</div>
				<Separator orientation="vertical" />
				<div>Docs</div>
				<Separator orientation="vertical" />
				<div>Source</div>
			</div>
		</div>
	),
};

export const Vertical: Story = {
	render: () => (
		<div className="flex h-5 items-center space-x-4 text-sm">
			<div>Home</div>
			<Separator orientation="vertical" />
			<div>About</div>
			<Separator orientation="vertical" />
			<div>Contact</div>
		</div>
	),
};

export const InList: Story = {
	render: () => (
		<div className="w-[300px] rounded-md border p-4">
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">Requests</span>
					<span className="text-sm text-muted-foreground">1,234</span>
				</div>
				<Separator />
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">Errors</span>
					<span className="text-sm text-muted-foreground">12</span>
				</div>
				<Separator />
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">Avg Response</span>
					<span className="text-sm text-muted-foreground">145ms</span>
				</div>
			</div>
		</div>
	),
};
