import type { Meta, StoryObj } from '@storybook/react';
import { Label } from './label';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from './select';

const meta: Meta<typeof Select> = {
	title: 'Components/Select',
	component: Select,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
	},
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
	render: () => (
		<Select>
			<SelectTrigger className="w-[180px]">
				<SelectValue placeholder="Select a fruit" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="apple">Apple</SelectItem>
				<SelectItem value="banana">Banana</SelectItem>
				<SelectItem value="orange">Orange</SelectItem>
				<SelectItem value="grape">Grape</SelectItem>
				<SelectItem value="mango">Mango</SelectItem>
			</SelectContent>
		</Select>
	),
};

export const WithLabel: Story = {
	render: () => (
		<div className="grid w-full max-w-sm items-center gap-1.5">
			<Label htmlFor="framework">Framework</Label>
			<Select>
				<SelectTrigger id="framework">
					<SelectValue placeholder="Select framework" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="next">Next.js</SelectItem>
					<SelectItem value="remix">Remix</SelectItem>
					<SelectItem value="astro">Astro</SelectItem>
					<SelectItem value="gatsby">Gatsby</SelectItem>
				</SelectContent>
			</Select>
		</div>
	),
};

export const WithGroups: Story = {
	render: () => (
		<Select>
			<SelectTrigger className="w-[280px]">
				<SelectValue placeholder="Select a timezone" />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					<SelectLabel>North America</SelectLabel>
					<SelectItem value="est">Eastern Standard Time (EST)</SelectItem>
					<SelectItem value="cst">Central Standard Time (CST)</SelectItem>
					<SelectItem value="mst">Mountain Standard Time (MST)</SelectItem>
					<SelectItem value="pst">Pacific Standard Time (PST)</SelectItem>
				</SelectGroup>
				<SelectSeparator />
				<SelectGroup>
					<SelectLabel>Europe & Africa</SelectLabel>
					<SelectItem value="gmt">Greenwich Mean Time (GMT)</SelectItem>
					<SelectItem value="cet">Central European Time (CET)</SelectItem>
					<SelectItem value="eet">Eastern European Time (EET)</SelectItem>
				</SelectGroup>
				<SelectSeparator />
				<SelectGroup>
					<SelectLabel>Asia</SelectLabel>
					<SelectItem value="ist">India Standard Time (IST)</SelectItem>
					<SelectItem value="cst_china">China Standard Time (CST)</SelectItem>
					<SelectItem value="jst">Japan Standard Time (JST)</SelectItem>
				</SelectGroup>
			</SelectContent>
		</Select>
	),
};

export const Disabled: Story = {
	render: () => (
		<Select disabled>
			<SelectTrigger className="w-[180px]">
				<SelectValue placeholder="Disabled" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="option">Option</SelectItem>
			</SelectContent>
		</Select>
	),
};

export const HttpMethods: Story = {
	render: () => (
		<Select defaultValue="get">
			<SelectTrigger className="w-[120px]">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="get">GET</SelectItem>
				<SelectItem value="post">POST</SelectItem>
				<SelectItem value="put">PUT</SelectItem>
				<SelectItem value="patch">PATCH</SelectItem>
				<SelectItem value="delete">DELETE</SelectItem>
			</SelectContent>
		</Select>
	),
};
