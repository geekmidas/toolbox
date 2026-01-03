import type { Meta, StoryObj } from '@storybook/react';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { SplitPane, SplitPanePanel } from './split-pane';

const meta: Meta<typeof SplitPane> = {
  title: 'Layout/SplitPane',
  component: SplitPane,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="h-screen bg-background p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SplitPane>;

export const Horizontal: Story = {
  render: () => (
    <SplitPane
      defaultSize="40%"
      className="h-full rounded-lg border border-border"
    >
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Left Panel</h3>
        <p className="text-sm text-muted-foreground">
          This is the left panel. Drag the divider to resize.
        </p>
      </SplitPanePanel>
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Right Panel</h3>
        <p className="text-sm text-muted-foreground">
          This is the right panel. It will take up the remaining space.
        </p>
      </SplitPanePanel>
    </SplitPane>
  ),
};

export const Vertical: Story = {
  render: () => (
    <SplitPane
      direction="vertical"
      defaultSize="30%"
      className="h-full rounded-lg border border-border"
    >
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Top Panel</h3>
        <p className="text-sm text-muted-foreground">
          This is the top panel. Drag the divider to resize vertically.
        </p>
      </SplitPanePanel>
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Bottom Panel</h3>
        <p className="text-sm text-muted-foreground">
          This is the bottom panel.
        </p>
      </SplitPanePanel>
    </SplitPane>
  ),
};

const mockRequests = Array.from({ length: 20 }).map((_, i) => ({
  id: `req-${i + 1}`,
  method: ['GET', 'POST', 'PUT', 'DELETE'][i % 4],
  path: `/api/users${i % 3 === 0 ? '' : `/${i}`}`,
  status: [200, 201, 400, 404, 500][i % 5],
  duration: `${Math.floor(Math.random() * 300 + 20)}ms`,
  timestamp: new Date(Date.now() - i * 60000).toISOString(),
}));

export const MasterDetail: Story = {
  render: function MasterDetailExample() {
    const [selectedId, setSelectedId] = useState<string | null>(
      mockRequests[0]?.id ?? null,
    );
    const selected = mockRequests.find((r) => r.id === selectedId);

    return (
      <SplitPane
        defaultSize={320}
        minSize={200}
        maxSize={500}
        className="h-full rounded-lg border border-border overflow-hidden"
      >
        <SplitPanePanel>
          <div className="h-full flex flex-col bg-surface">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-sm">Requests</h3>
            </div>
            <ScrollArea className="flex-1">
              {mockRequests.map((req) => (
                <button
                  key={req.id}
                  onClick={() => setSelectedId(req.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-hover ${
                    selectedId === req.id ? 'bg-surface-hover' : ''
                  }`}
                >
                  <Badge
                    variant={
                      req.method.toLowerCase() as
                        | 'get'
                        | 'post'
                        | 'put'
                        | 'delete'
                    }
                    className="w-14 justify-center text-xs"
                  >
                    {req.method}
                  </Badge>
                  <span className="flex-1 truncate text-sm font-mono">
                    {req.path}
                  </span>
                  <Badge
                    variant={
                      req.status >= 500
                        ? 'destructive'
                        : req.status >= 400
                          ? 'warning'
                          : 'success'
                    }
                    className="text-xs"
                  >
                    {req.status}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </ScrollArea>
          </div>
        </SplitPanePanel>

        <SplitPanePanel>
          <div className="h-full bg-background p-4">
            {selected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Badge
                    variant={
                      selected.method.toLowerCase() as
                        | 'get'
                        | 'post'
                        | 'put'
                        | 'delete'
                    }
                  >
                    {selected.method}
                  </Badge>
                  <span className="font-mono text-lg">{selected.path}</span>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">
                        Status
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Badge
                        variant={
                          selected.status >= 500
                            ? 'destructive'
                            : selected.status >= 400
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {selected.status}
                      </Badge>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">
                        Duration
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <span className="text-lg font-semibold">
                        {selected.duration}
                      </span>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground">
                        Timestamp
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <span className="text-sm text-muted-foreground">
                        {new Date(selected.timestamp).toLocaleTimeString()}
                      </span>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Request Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs text-muted-foreground bg-background rounded p-3 overflow-auto">
                      {JSON.stringify(selected, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                Select a request to view details
              </div>
            )}
          </div>
        </SplitPanePanel>
      </SplitPane>
    );
  },
};

export const Nested: Story = {
  render: () => (
    <SplitPane
      defaultSize="30%"
      className="h-full rounded-lg border border-border"
    >
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Navigation</h3>
        <div className="space-y-1">
          {['Dashboard', 'Requests', 'Logs', 'Exceptions'].map((item) => (
            <div
              key={item}
              className="px-3 py-2 rounded-md text-sm hover:bg-surface-hover cursor-pointer"
            >
              {item}
            </div>
          ))}
        </div>
      </SplitPanePanel>

      <SplitPanePanel>
        <SplitPane direction="vertical" defaultSize="60%">
          <SplitPanePanel className="bg-background p-4">
            <h3 className="font-semibold mb-2">Main Content</h3>
            <p className="text-sm text-muted-foreground">
              This is the main content area with nested split panes.
            </p>
          </SplitPanePanel>
          <SplitPanePanel className="bg-surface p-4">
            <h3 className="font-semibold mb-2">Details Panel</h3>
            <p className="text-sm text-muted-foreground">
              This panel shows additional details.
            </p>
          </SplitPanePanel>
        </SplitPane>
      </SplitPanePanel>
    </SplitPane>
  ),
};

export const NotResizable: Story = {
  render: () => (
    <SplitPane
      defaultSize="40%"
      resizable={false}
      className="h-full rounded-lg border border-border"
    >
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Fixed Left Panel</h3>
        <p className="text-sm text-muted-foreground">
          This panel has a fixed width and cannot be resized.
        </p>
      </SplitPanePanel>
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Fixed Right Panel</h3>
        <p className="text-sm text-muted-foreground">
          The divider is not draggable.
        </p>
      </SplitPanePanel>
    </SplitPane>
  ),
};

export const WithMinMax: Story = {
  render: () => (
    <SplitPane
      defaultSize={300}
      minSize={200}
      maxSize={400}
      className="h-full rounded-lg border border-border"
    >
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Constrained Panel</h3>
        <p className="text-sm text-muted-foreground">
          This panel can only be resized between 200px and 400px.
        </p>
      </SplitPanePanel>
      <SplitPanePanel className="bg-surface p-4">
        <h3 className="font-semibold mb-2">Flexible Panel</h3>
        <p className="text-sm text-muted-foreground">
          This panel takes up the remaining space.
        </p>
      </SplitPanePanel>
    </SplitPane>
  ),
};
