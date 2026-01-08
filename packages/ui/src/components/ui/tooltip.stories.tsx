import type { Meta, StoryObj } from '@storybook/react';
import { Plus } from 'lucide-react';
import { Button } from './button';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from './tooltip';

const meta: Meta<typeof Tooltip> = {
	title: 'Components/Tooltip',
	component: Tooltip,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
	},
	decorators: [
		(Story) => (
			<TooltipProvider>
				<Story />
			</TooltipProvider>
		),
	],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
	render: () => (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="outline">Hover me</Button>
			</TooltipTrigger>
			<TooltipContent>
				<p>This is a tooltip</p>
			</TooltipContent>
		</Tooltip>
	),
};

export const Positions: Story = {
	render: () => (
		<div className="flex gap-4">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline">Top</Button>
				</TooltipTrigger>
				<TooltipContent side="top">
					<p>Top tooltip</p>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline">Right</Button>
				</TooltipTrigger>
				<TooltipContent side="right">
					<p>Right tooltip</p>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline">Bottom</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<p>Bottom tooltip</p>
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline">Left</Button>
				</TooltipTrigger>
				<TooltipContent side="left">
					<p>Left tooltip</p>
				</TooltipContent>
			</Tooltip>
		</div>
	),
};

export const IconButton: Story = {
	render: () => (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button size="icon" variant="outline">
					<Plus className="h-4 w-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				<p>Add new item</p>
			</TooltipContent>
		</Tooltip>
	),
};

export const WithDelay: Story = {
	render: () => (
		<Tooltip delayDuration={500}>
			<TooltipTrigger asChild>
				<Button variant="outline">Delayed tooltip (500ms)</Button>
			</TooltipTrigger>
			<TooltipContent>
				<p>This tooltip has a delay</p>
			</TooltipContent>
		</Tooltip>
	),
};

export const LongContent: Story = {
	render: () => (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="outline">Hover for details</Button>
			</TooltipTrigger>
			<TooltipContent className="max-w-[200px]">
				<p>
					This is a longer tooltip with more detailed information about the
					element.
				</p>
			</TooltipContent>
		</Tooltip>
	),
};
