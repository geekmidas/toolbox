import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from '../ui/button';
import {
  LoadingContainer,
  LoadingDots,
  LoadingOverlay,
  Skeleton,
  Spinner,
} from './loading';

const meta: Meta<typeof Spinner> = {
  title: 'Feedback/Loading',
  component: Spinner,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const SpinnerDefault: Story = {
  render: () => <Spinner />,
};

export const SpinnerSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner size="xs" />
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
      <Spinner size="xl" />
    </div>
  ),
};

export const SpinnerColors: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner className="text-muted-foreground" />
      <Spinner className="text-accent" />
      <Spinner className="text-blue-500" />
      <Spinner className="text-red-500" />
      <Spinner className="text-amber-500" />
    </div>
  ),
};

export const SpinnerInButton: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button disabled>
        <Spinner size="sm" className="mr-2" />
        Loading...
      </Button>
      <Button variant="outline" disabled>
        <Spinner size="sm" className="mr-2" />
        Please wait
      </Button>
    </div>
  ),
};

export const DotsDefault: StoryObj<typeof LoadingDots> = {
  render: () => <LoadingDots />,
};

export const DotsSizes: StoryObj<typeof LoadingDots> = {
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <LoadingDots size="sm" />
      <LoadingDots size="md" />
      <LoadingDots size="lg" />
    </div>
  ),
};

export const Overlay: StoryObj<typeof LoadingOverlay> = {
  render: () => (
    <div className="relative w-64 h-40 bg-surface border border-border rounded-md">
      <div className="p-4">
        <h3 className="font-semibold">Card Content</h3>
        <p className="text-sm text-muted-foreground">
          This content is being loaded...
        </p>
      </div>
      <LoadingOverlay loading text="Loading..." />
    </div>
  ),
};

export const OverlayVariants: StoryObj<typeof LoadingOverlay> = {
  render: () => (
    <div className="flex gap-4">
      <div className="relative w-48 h-32 bg-surface border border-border rounded-md">
        <div className="p-4 text-sm">Light overlay</div>
        <LoadingOverlay loading variant="light" spinnerSize="md" />
      </div>
      <div className="relative w-48 h-32 bg-surface border border-border rounded-md">
        <div className="p-4 text-sm">Default overlay</div>
        <LoadingOverlay loading variant="default" spinnerSize="md" />
      </div>
      <div className="relative w-48 h-32 bg-surface border border-border rounded-md">
        <div className="p-4 text-sm">Dark overlay</div>
        <LoadingOverlay loading variant="dark" spinnerSize="md" />
      </div>
    </div>
  ),
};

export const Container: StoryObj<typeof LoadingContainer> = {
  render: function ContainerExample() {
    const [loading, setLoading] = useState(true);

    return (
      <div className="space-y-4">
        <Button onClick={() => setLoading(!loading)}>
          {loading ? 'Stop Loading' : 'Start Loading'}
        </Button>
        <LoadingContainer
          loading={loading}
          loadingText="Fetching data..."
          className="w-64 h-40 bg-surface border border-border rounded-md"
        >
          <div className="p-4">
            <h3 className="font-semibold">Data Loaded</h3>
            <p className="text-sm text-muted-foreground">
              Content is now visible!
            </p>
          </div>
        </LoadingContainer>
      </div>
    );
  },
};

export const SkeletonBasic: StoryObj<typeof Skeleton> = {
  render: () => (
    <div className="space-y-2">
      <Skeleton width={200} height={20} />
      <Skeleton width={150} height={20} />
      <Skeleton width={180} height={20} />
    </div>
  ),
};

export const SkeletonCard: StoryObj<typeof Skeleton> = {
  render: () => (
    <div className="w-64 p-4 bg-surface border border-border rounded-md space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton width={40} height={40} rounded="full" />
        <div className="space-y-2">
          <Skeleton width={100} height={14} />
          <Skeleton width={60} height={12} />
        </div>
      </div>
      <Skeleton width="100%" height={80} />
      <div className="flex gap-2">
        <Skeleton width={60} height={24} />
        <Skeleton width={60} height={24} />
      </div>
    </div>
  ),
};

export const SkeletonTable: StoryObj<typeof Skeleton> = {
  render: () => (
    <div className="w-[400px] border border-border rounded-md overflow-hidden">
      <div className="p-3 border-b border-border flex items-center gap-4">
        <Skeleton width={80} height={14} />
        <Skeleton width={120} height={14} />
        <Skeleton width={60} height={14} />
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="p-3 border-b border-border last:border-b-0 flex items-center gap-4"
        >
          <Skeleton width={80} height={12} />
          <Skeleton width={120} height={12} />
          <Skeleton width={40} height={20} rounded="full" />
        </div>
      ))}
    </div>
  ),
};

export const SkeletonList: StoryObj<typeof Skeleton> = {
  render: () => (
    <div className="w-80 space-y-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 bg-surface border border-border rounded-md"
        >
          <Skeleton width={32} height={32} rounded="full" />
          <div className="flex-1 space-y-2">
            <Skeleton width="60%" height={14} />
            <Skeleton width="40%" height={12} />
          </div>
          <Skeleton width={50} height={24} />
        </div>
      ))}
    </div>
  ),
};

export const SkeletonRounded: StoryObj<typeof Skeleton> = {
  render: () => (
    <div className="flex items-center gap-4">
      <Skeleton width={40} height={40} rounded={false} />
      <Skeleton width={40} height={40} rounded="sm" />
      <Skeleton width={40} height={40} rounded="md" />
      <Skeleton width={40} height={40} rounded="lg" />
      <Skeleton width={40} height={40} rounded="full" />
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium mb-4">Spinners</h3>
        <div className="flex items-center gap-4">
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-4">Loading Dots</h3>
        <div className="flex items-center gap-4">
          <LoadingDots size="sm" />
          <LoadingDots size="md" />
          <LoadingDots size="lg" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-4">Skeletons</h3>
        <div className="flex items-center gap-4">
          <Skeleton width={100} height={20} />
          <Skeleton width={40} height={40} rounded="full" />
          <Skeleton width={60} height={24} />
        </div>
      </div>
    </div>
  ),
};
