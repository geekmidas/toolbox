import type { Meta, StoryObj } from '@storybook/react';
import {
  Activity,
  AlertCircle,
  Database,
  FileText,
  Home,
  Layers,
  Network,
  RefreshCw,
  Settings,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Header,
  HeaderActions,
  HeaderBreadcrumbs,
  HeaderGroup,
  HeaderTitle,
} from './header';
import {
  Shell,
  ShellContent,
  ShellFooter,
  ShellHeader,
  ShellMain,
  ShellSidebar,
} from './shell';
import { Sidebar, SidebarItem, SidebarSection, SidebarToggle } from './sidebar';

const meta: Meta<typeof Shell> = {
  title: 'Layout/Shell',
  component: Shell,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof Shell>;

export const Default: Story = {
  render: function DefaultShell() {
    const [collapsed, setCollapsed] = useState(false);
    const [active, setActive] = useState('dashboard');

    return (
      <Shell>
        <ShellSidebar>
          <Sidebar
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            header={
              collapsed ? (
                <div className="flex items-center justify-center">
                  <Zap className="h-5 w-5 text-accent" />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-accent" />
                  <span className="font-semibold">Dev Studio</span>
                </div>
              )
            }
            footer={<SidebarToggle />}
          >
            <SidebarSection>
              <SidebarItem
                icon={Home}
                active={active === 'dashboard'}
                onClick={() => setActive('dashboard')}
              >
                Dashboard
              </SidebarItem>
              <SidebarItem
                icon={Activity}
                active={active === 'requests'}
                onClick={() => setActive('requests')}
                badge={
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                    23
                  </Badge>
                }
              >
                Requests
              </SidebarItem>
              <SidebarItem
                icon={FileText}
                active={active === 'logs'}
                onClick={() => setActive('logs')}
              >
                Logs
              </SidebarItem>
              <SidebarItem
                icon={AlertCircle}
                active={active === 'exceptions'}
                onClick={() => setActive('exceptions')}
              >
                Exceptions
              </SidebarItem>
            </SidebarSection>

            <SidebarSection title="Data">
              <SidebarItem
                icon={Database}
                active={active === 'database'}
                onClick={() => setActive('database')}
              >
                Database
              </SidebarItem>
              <SidebarItem
                icon={Layers}
                active={active === 'cache'}
                onClick={() => setActive('cache')}
              >
                Cache
              </SidebarItem>
            </SidebarSection>

            <SidebarSection title="System">
              <SidebarItem
                icon={Network}
                active={active === 'services'}
                onClick={() => setActive('services')}
              >
                Services
              </SidebarItem>
              <SidebarItem
                icon={Settings}
                active={active === 'settings'}
                onClick={() => setActive('settings')}
              >
                Settings
              </SidebarItem>
            </SidebarSection>
          </Sidebar>
        </ShellSidebar>

        <ShellMain>
          <ShellHeader>
            <Header>
              <HeaderGroup>
                <HeaderTitle className="capitalize">{active}</HeaderTitle>
                <Badge variant="success" className="gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </Badge>
              </HeaderGroup>
              <HeaderActions>
                <Button variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </HeaderActions>
            </Header>
          </ShellHeader>

          <ShellContent className="p-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Total Requests
                  </CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">1,234</div>
                  <p className="text-xs text-muted-foreground">
                    +12% from last hour
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Avg Response Time
                  </CardTitle>
                  <Zap className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">45ms</div>
                  <p className="text-xs text-muted-foreground">
                    -5ms from last hour
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Error Rate
                  </CardTitle>
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">0.5%</div>
                  <p className="text-xs text-muted-foreground">
                    +0.1% from last hour
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Active Services
                  </CardTitle>
                  <Network className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">12</div>
                  <p className="text-xs text-muted-foreground">
                    All services healthy
                  </p>
                </CardContent>
              </Card>
            </div>
          </ShellContent>
        </ShellMain>
      </Shell>
    );
  },
};

export const WithBreadcrumbs: Story = {
  render: function BreadcrumbsShell() {
    const [collapsed, setCollapsed] = useState(false);

    return (
      <Shell>
        <ShellSidebar>
          <Sidebar
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            header={
              collapsed ? (
                <div className="flex items-center justify-center">
                  <Zap className="h-5 w-5 text-accent" />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-accent" />
                  <span className="font-semibold">Dev Studio</span>
                </div>
              )
            }
            footer={<SidebarToggle />}
          >
            <SidebarSection>
              <SidebarItem icon={Home}>Dashboard</SidebarItem>
              <SidebarItem icon={Activity} active>
                Requests
              </SidebarItem>
            </SidebarSection>
          </Sidebar>
        </ShellSidebar>

        <ShellMain>
          <ShellHeader>
            <Header>
              <HeaderBreadcrumbs
                items={[
                  { label: 'Requests', href: '#' },
                  { label: 'GET /api/users', current: true },
                ]}
              />
              <HeaderActions>
                <Button variant="outline" size="sm">
                  Replay
                </Button>
              </HeaderActions>
            </Header>
          </ShellHeader>

          <ShellContent className="p-6">
            <Card>
              <CardHeader>
                <CardTitle>Request Details</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Request details would go here...
                </p>
              </CardContent>
            </Card>
          </ShellContent>
        </ShellMain>
      </Shell>
    );
  },
};

export const WithFooter: Story = {
  render: function FooterShell() {
    const [collapsed, setCollapsed] = useState(false);

    return (
      <Shell>
        <ShellSidebar>
          <Sidebar
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            header={
              collapsed ? (
                <div className="flex items-center justify-center">
                  <Zap className="h-5 w-5 text-accent" />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-accent" />
                  <span className="font-semibold">Dev Studio</span>
                </div>
              )
            }
            footer={<SidebarToggle />}
          >
            <SidebarSection>
              <SidebarItem icon={Home}>Dashboard</SidebarItem>
              <SidebarItem icon={Database} active>
                Database
              </SidebarItem>
            </SidebarSection>
          </Sidebar>
        </ShellSidebar>

        <ShellMain>
          <ShellHeader>
            <Header>
              <HeaderBreadcrumbs
                items={[
                  { label: 'Database', href: '#' },
                  { label: 'users', current: true },
                ]}
              />
              <HeaderActions>
                <Button variant="outline" size="sm">
                  Export
                </Button>
                <Button size="sm">Insert Row</Button>
              </HeaderActions>
            </Header>
          </ShellHeader>

          <ShellContent className="p-6">
            <div className="h-full rounded-lg border border-border bg-surface flex items-center justify-center text-muted-foreground">
              Table content would go here...
            </div>
          </ShellContent>

          <ShellFooter className="px-4 py-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Showing 1-50 of 1,234 rows
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled>
                Previous
              </Button>
              <Button variant="outline" size="sm">
                Next
              </Button>
            </div>
          </ShellFooter>
        </ShellMain>
      </Shell>
    );
  },
};

export const MinimalShell: Story = {
  render: () => (
    <Shell>
      <ShellMain>
        <ShellHeader>
          <Header>
            <HeaderGroup>
              <Zap className="h-5 w-5 text-accent" />
              <HeaderTitle>Simple App</HeaderTitle>
            </HeaderGroup>
          </Header>
        </ShellHeader>
        <ShellContent className="p-6">
          <Card>
            <CardHeader>
              <CardTitle>Welcome</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                A simple shell layout without a sidebar.
              </p>
            </CardContent>
          </Card>
        </ShellContent>
      </ShellMain>
    </Shell>
  ),
};
