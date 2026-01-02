import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';
import { ScrollArea, ScrollBar } from './scroll-area';
import { Separator } from './separator';

const meta: Meta<typeof ScrollArea> = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof ScrollArea>;

const tags = Array.from({ length: 50 }).map(
  (_, i, a) => `v1.2.0-beta.${a.length - i}`
);

export const Vertical: Story = {
  render: () => (
    <ScrollArea className="h-72 w-48 rounded-md border">
      <div className="p-4">
        <h4 className="mb-4 text-sm font-medium leading-none">Tags</h4>
        {tags.map((tag) => (
          <div key={tag}>
            <div className="text-sm">{tag}</div>
            <Separator className="my-2" />
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

const requests = Array.from({ length: 20 }).map((_, i) => ({
  id: `req-${i + 1}`,
  method: ['GET', 'POST', 'PUT', 'DELETE'][i % 4],
  path: `/api/users/${i % 5 === 0 ? '' : i}`,
  status: [200, 201, 400, 404, 500][i % 5],
  duration: `${Math.floor(Math.random() * 300 + 20)}ms`,
}));

export const RequestList: Story = {
  render: () => (
    <ScrollArea className="h-80 w-96 rounded-md border">
      <div className="p-4">
        <h4 className="mb-4 text-sm font-medium leading-none">Recent Requests</h4>
        {requests.map((req) => (
          <div key={req.id}>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    req.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'
                  }
                  className="w-16 justify-center"
                >
                  {req.method}
                </Badge>
                <span className="text-sm font-mono">{req.path}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    req.status >= 500
                      ? 'destructive'
                      : req.status >= 400
                        ? 'warning'
                        : 'success'
                  }
                >
                  {req.status}
                </Badge>
                <span className="text-xs text-muted-foreground w-12 text-right">
                  {req.duration}
                </span>
              </div>
            </div>
            <Separator />
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

const artwork = [
  { artist: 'Ornella Binni', art: 'Reflection' },
  { artist: 'Tom Byrom', art: 'Mountain Mist' },
  { artist: 'Vladimir Malyavko', art: 'Spring Blossom' },
  { artist: 'Ornella Binni', art: 'Golden Hour' },
  { artist: 'Tom Byrom', art: 'Ocean Waves' },
  { artist: 'Vladimir Malyavko', art: 'Autumn Leaves' },
  { artist: 'Ornella Binni', art: 'City Lights' },
  { artist: 'Tom Byrom', art: 'Forest Path' },
];

export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="w-96 whitespace-nowrap rounded-md border">
      <div className="flex w-max space-x-4 p-4">
        {artwork.map((item) => (
          <div key={item.art} className="w-[150px] shrink-0">
            <div className="h-[100px] rounded-md bg-muted" />
            <div className="mt-2 space-y-1">
              <h3 className="text-sm font-medium leading-none">{item.art}</h3>
              <p className="text-xs text-muted-foreground">{item.artist}</p>
            </div>
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
};

export const CodeBlock: Story = {
  render: () => (
    <ScrollArea className="h-48 w-96 rounded-md border bg-muted/50">
      <pre className="p-4 text-xs font-mono">
        {`import { Hono } from 'hono';
import { Studio } from '@geekmidas/studio';
import { InMemoryStorage } from '@geekmidas/telescope';

const app = new Hono();
const studio = new Studio({
  monitoring: {
    storage: new InMemoryStorage(),
    recordBody: true,
    maxBodySize: 64 * 1024,
    redact: ['password', 'token'],
  },
  data: {
    db: kyselyInstance,
    schema: 'public',
    cursor: { field: 'id', direction: 'desc' },
  },
});

app.route('/__studio', createStudioApp(studio));

export default app;`}
      </pre>
    </ScrollArea>
  ),
};
