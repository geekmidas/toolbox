import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from './card';
import { Input } from './input';
import { Label } from './label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta: Meta<typeof Tabs> = {
	title: 'Components/Tabs',
	component: Tabs,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
	},
};

export default meta;
type Story = StoryObj<typeof Tabs>;

export const Default: Story = {
	render: () => (
		<Tabs defaultValue="account" className="w-[400px]">
			<TabsList>
				<TabsTrigger value="account">Account</TabsTrigger>
				<TabsTrigger value="password">Password</TabsTrigger>
			</TabsList>
			<TabsContent value="account">
				<Card>
					<CardHeader>
						<CardTitle>Account</CardTitle>
						<CardDescription>
							Make changes to your account here. Click save when you&apos;re
							done.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<div className="space-y-1">
							<Label htmlFor="name">Name</Label>
							<Input id="name" defaultValue="John Doe" />
						</div>
						<div className="space-y-1">
							<Label htmlFor="username">Username</Label>
							<Input id="username" defaultValue="@johndoe" />
						</div>
					</CardContent>
					<CardFooter>
						<Button>Save changes</Button>
					</CardFooter>
				</Card>
			</TabsContent>
			<TabsContent value="password">
				<Card>
					<CardHeader>
						<CardTitle>Password</CardTitle>
						<CardDescription>
							Change your password here. After saving, you&apos;ll be logged
							out.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<div className="space-y-1">
							<Label htmlFor="current">Current password</Label>
							<Input id="current" type="password" />
						</div>
						<div className="space-y-1">
							<Label htmlFor="new">New password</Label>
							<Input id="new" type="password" />
						</div>
					</CardContent>
					<CardFooter>
						<Button>Save password</Button>
					</CardFooter>
				</Card>
			</TabsContent>
		</Tabs>
	),
};

export const Simple: Story = {
	render: () => (
		<Tabs defaultValue="overview" className="w-[400px]">
			<TabsList>
				<TabsTrigger value="overview">Overview</TabsTrigger>
				<TabsTrigger value="analytics">Analytics</TabsTrigger>
				<TabsTrigger value="reports">Reports</TabsTrigger>
			</TabsList>
			<TabsContent value="overview" className="p-4">
				<p className="text-sm text-muted-foreground">
					Overview content goes here. This tab shows the main dashboard view.
				</p>
			</TabsContent>
			<TabsContent value="analytics" className="p-4">
				<p className="text-sm text-muted-foreground">
					Analytics content goes here. View your performance metrics and trends.
				</p>
			</TabsContent>
			<TabsContent value="reports" className="p-4">
				<p className="text-sm text-muted-foreground">
					Reports content goes here. Generate and view detailed reports.
				</p>
			</TabsContent>
		</Tabs>
	),
};

export const RequestTabs: Story = {
	render: () => (
		<Tabs defaultValue="headers" className="w-[500px]">
			<TabsList>
				<TabsTrigger value="headers">Headers</TabsTrigger>
				<TabsTrigger value="body">Body</TabsTrigger>
				<TabsTrigger value="params">Query Params</TabsTrigger>
				<TabsTrigger value="response">Response</TabsTrigger>
			</TabsList>
			<TabsContent value="headers" className="p-4 border rounded-b-md">
				<pre className="text-xs font-mono">
					{`Content-Type: application/json
Authorization: Bearer ***
User-Agent: Mozilla/5.0`}
				</pre>
			</TabsContent>
			<TabsContent value="body" className="p-4 border rounded-b-md">
				<pre className="text-xs font-mono">
					{`{
  "name": "John Doe",
  "email": "john@example.com"
}`}
				</pre>
			</TabsContent>
			<TabsContent value="params" className="p-4 border rounded-b-md">
				<pre className="text-xs font-mono">
					{`page=1
limit=10
sort=created_at`}
				</pre>
			</TabsContent>
			<TabsContent value="response" className="p-4 border rounded-b-md">
				<pre className="text-xs font-mono">
					{`{
  "id": "123",
  "status": "success"
}`}
				</pre>
			</TabsContent>
		</Tabs>
	),
};
