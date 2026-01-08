import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input';
import { Label } from './label';

const meta: Meta<typeof Input> = {
	title: 'Components/Input',
	component: Input,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
	},
	argTypes: {
		type: {
			control: 'select',
			options: ['text', 'password', 'email', 'number', 'search', 'tel', 'url'],
		},
		disabled: {
			control: 'boolean',
		},
		placeholder: {
			control: 'text',
		},
	},
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
	args: {
		placeholder: 'Enter text...',
	},
};

export const Email: Story = {
	args: {
		type: 'email',
		placeholder: 'email@example.com',
	},
};

export const Password: Story = {
	args: {
		type: 'password',
		placeholder: 'Enter password',
	},
};

export const Disabled: Story = {
	args: {
		disabled: true,
		placeholder: 'Disabled input',
	},
};

export const WithValue: Story = {
	args: {
		defaultValue: 'Hello, World!',
	},
};

export const WithLabel: Story = {
	render: () => (
		<div className="grid w-full max-w-sm items-center gap-1.5">
			<Label htmlFor="email">Email</Label>
			<Input type="email" id="email" placeholder="Email" />
		</div>
	),
};

export const File: Story = {
	render: () => (
		<div className="grid w-full max-w-sm items-center gap-1.5">
			<Label htmlFor="file">Upload file</Label>
			<Input id="file" type="file" />
		</div>
	),
};

export const AllTypes: Story = {
	render: () => (
		<div className="flex flex-col gap-4 w-80">
			<Input type="text" placeholder="Text input" />
			<Input type="email" placeholder="Email input" />
			<Input type="password" placeholder="Password input" />
			<Input type="number" placeholder="Number input" />
			<Input type="search" placeholder="Search input" />
			<Input type="tel" placeholder="Phone input" />
			<Input type="url" placeholder="URL input" />
		</div>
	),
};
