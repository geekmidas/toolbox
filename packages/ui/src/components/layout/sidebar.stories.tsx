import type { Meta, StoryObj } from '@storybook/react';
import {
  Activity,
  AlertCircle,
  Database,
  FileText,
  Home,
  Layers,
  Network,
  Settings,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import {
  Sidebar,
  SidebarItem,
  SidebarLink,
  SidebarSection,
  SidebarToggle,
} from './sidebar';

const meta: Meta<typeof Sidebar> = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="h-screen bg-background">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

export const Default: Story = {
  render: () => (
    <Sidebar
      header={
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-accent" />
          <span className="font-semibold">Dev Studio</span>
        </div>
      }
      footer={<SidebarToggle />}
    >
      <SidebarSection>
        <SidebarItem icon={Home} active>
          Dashboard
        </SidebarItem>
        <SidebarItem icon={Activity}>Requests</SidebarItem>
        <SidebarItem icon={FileText}>Logs</SidebarItem>
        <SidebarItem icon={AlertCircle}>Exceptions</SidebarItem>
      </SidebarSection>

      <SidebarSection title="Data">
        <SidebarItem icon={Database}>Database</SidebarItem>
        <SidebarItem icon={Layers}>Cache</SidebarItem>
      </SidebarSection>

      <SidebarSection title="System">
        <SidebarItem icon={Network}>Services</SidebarItem>
        <SidebarItem icon={Settings}>Settings</SidebarItem>
      </SidebarSection>
    </Sidebar>
  ),
};

export const Collapsed: Story = {
  render: () => (
    <Sidebar
      collapsed
      header={
        <div className="flex items-center justify-center">
          <Zap className="h-5 w-5 text-accent" />
        </div>
      }
      footer={<SidebarToggle />}
    >
      <SidebarSection>
        <SidebarItem icon={Home} active>
          Dashboard
        </SidebarItem>
        <SidebarItem icon={Activity}>Requests</SidebarItem>
        <SidebarItem icon={FileText}>Logs</SidebarItem>
        <SidebarItem icon={AlertCircle}>Exceptions</SidebarItem>
      </SidebarSection>

      <SidebarSection title="Data">
        <SidebarItem icon={Database}>Database</SidebarItem>
        <SidebarItem icon={Layers}>Cache</SidebarItem>
      </SidebarSection>
    </Sidebar>
  ),
};

export const Interactive: Story = {
  render: function InteractiveSidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const [active, setActive] = useState('dashboard');

    const items = [
      { id: 'dashboard', icon: Home, label: 'Dashboard' },
      { id: 'requests', icon: Activity, label: 'Requests', badge: '23' },
      { id: 'logs', icon: FileText, label: 'Logs' },
      { id: 'exceptions', icon: AlertCircle, label: 'Exceptions', badge: '3' },
    ];

    return (
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
          {items.map((item) => (
            <SidebarItem
              key={item.id}
              icon={item.icon}
              active={active === item.id}
              onClick={() => setActive(item.id)}
              badge={
                item.badge ? (
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                    {item.badge}
                  </Badge>
                ) : undefined
              }
            >
              {item.label}
            </SidebarItem>
          ))}
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
      </Sidebar>
    );
  },
};

export const WithLinks: Story = {
  render: () => (
    <Sidebar
      header={
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-accent" />
          <span className="font-semibold">Dev Studio</span>
        </div>
      }
    >
      <SidebarSection>
        <SidebarLink href="#dashboard" icon={Home} active>
          Dashboard
        </SidebarLink>
        <SidebarLink href="#requests" icon={Activity}>
          Requests
        </SidebarLink>
        <SidebarLink href="#logs" icon={FileText}>
          Logs
        </SidebarLink>
        <SidebarLink href="#exceptions" icon={AlertCircle}>
          Exceptions
        </SidebarLink>
      </SidebarSection>
    </Sidebar>
  ),
};

export const WithBadges: Story = {
  render: () => (
    <Sidebar
      header={
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-accent" />
          <span className="font-semibold">Dev Studio</span>
        </div>
      }
    >
      <SidebarSection>
        <SidebarItem icon={Home}>Dashboard</SidebarItem>
        <SidebarItem
          icon={Activity}
          badge={
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              156
            </Badge>
          }
        >
          Requests
        </SidebarItem>
        <SidebarItem
          icon={FileText}
          badge={
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              42
            </Badge>
          }
        >
          Logs
        </SidebarItem>
        <SidebarItem
          icon={AlertCircle}
          active
          badge={
            <Badge variant="destructive" className="h-5 px-1.5 text-xs">
              3
            </Badge>
          }
        >
          Exceptions
        </SidebarItem>
      </SidebarSection>
    </Sidebar>
  ),
};
