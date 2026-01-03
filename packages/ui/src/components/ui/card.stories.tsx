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

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description goes here.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Card content goes here. This is a basic card component.</p>
      </CardContent>
      <CardFooter>
        <Button>Action</Button>
      </CardFooter>
    </Card>
  ),
};

export const Simple: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Simple Card</CardTitle>
      </CardHeader>
      <CardContent>
        <p>A card with just a title and content.</p>
      </CardContent>
    </Card>
  ),
};

export const WithForm: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Create project</CardTitle>
        <CardDescription>Deploy your new project in one-click.</CardDescription>
      </CardHeader>
      <CardContent>
        <form>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="Name of your project" />
            </div>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline">Cancel</Button>
        <Button>Deploy</Button>
      </CardFooter>
    </Card>
  ),
};

export const Stats: Story = {
  render: () => (
    <div className="flex gap-4">
      <Card className="w-[200px]">
        <CardHeader className="pb-2">
          <CardDescription>Total Requests</CardDescription>
          <CardTitle className="text-4xl">1,284</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">+20% from last month</p>
        </CardContent>
      </Card>
      <Card className="w-[200px]">
        <CardHeader className="pb-2">
          <CardDescription>Error Rate</CardDescription>
          <CardTitle className="text-4xl">2.1%</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">-5% from last month</p>
        </CardContent>
      </Card>
      <Card className="w-[200px]">
        <CardHeader className="pb-2">
          <CardDescription>Avg Response</CardDescription>
          <CardTitle className="text-4xl">145ms</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">-10ms from last month</p>
        </CardContent>
      </Card>
    </div>
  ),
};

export const Notification: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>You have 3 unread messages.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center space-x-4 rounded-md border p-4">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium leading-none">
              Push Notifications
            </p>
            <p className="text-sm text-muted-foreground">
              Send notifications to device.
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-4 rounded-md border p-4">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium leading-none">
              Email Notifications
            </p>
            <p className="text-sm text-muted-foreground">
              Receive emails about activity.
            </p>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button className="w-full">Mark all as read</Button>
      </CardFooter>
    </Card>
  ),
};
