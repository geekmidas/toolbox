# @geekmidas/ui

Shared React UI components built on shadcn/ui and Radix UI primitives.

## Installation

```bash
pnpm add @geekmidas/ui
```

## Overview

This package provides pre-built React components following the shadcn/ui design system. Components are built on Radix UI primitives for accessibility and use Tailwind CSS for styling.

## Features

- Pre-built React components following shadcn/ui patterns
- Radix UI primitives for accessibility
- Tailwind CSS styling with CSS variables for theming
- TypeScript support with full type definitions
- Tree-shakable component exports
- Dark mode support

## Component Categories

### Layout

- Card, CardHeader, CardContent, CardFooter
- Container
- Separator
- Tabs, TabsList, TabsTrigger, TabsContent

### Data Display

- Table, TableHeader, TableBody, TableRow, TableCell
- Badge
- Avatar
- Code (syntax highlighting)

### Feedback

- Alert, AlertTitle, AlertDescription
- Toast, Toaster
- Progress
- Skeleton

### Forms

- Button
- Input
- Select, SelectTrigger, SelectContent, SelectItem
- Checkbox
- Switch
- Label

### Overlays

- Dialog, DialogTrigger, DialogContent
- DropdownMenu
- Popover
- Tooltip

## Usage

### Basic Components

```typescript
import { Button } from '@geekmidas/ui/components/button';
import { Card, CardHeader, CardTitle, CardContent } from '@geekmidas/ui/components/card';
import { Input } from '@geekmidas/ui/components/input';

function UserForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create User</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="Enter name" />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="Enter email" />
        </div>
        <Button type="submit">Submit</Button>
      </CardContent>
    </Card>
  );
}
```

### Button Variants

```typescript
import { Button } from '@geekmidas/ui/components/button';

// Variants
<Button variant="default">Default</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Destructive</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Sizes
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon">🔍</Button>

// States
<Button disabled>Disabled</Button>
<Button loading>Loading...</Button>
```

### Data Table

```typescript
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@geekmidas/ui/components/table';

function UsersTable({ users }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>{user.name}</TableCell>
            <TableCell>{user.email}</TableCell>
            <TableCell>
              <Badge variant={user.active ? 'default' : 'secondary'}>
                {user.active ? 'Active' : 'Inactive'}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### Dialog

```typescript
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@geekmidas/ui/components/dialog';

function ConfirmDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Toast Notifications

```typescript
import { useToast } from '@geekmidas/ui/hooks/use-toast';
import { Toaster } from '@geekmidas/ui/components/toaster';

function App() {
  return (
    <>
      <YourApp />
      <Toaster />
    </>
  );
}

function SaveButton() {
  const { toast } = useToast();

  const handleSave = async () => {
    try {
      await saveData();
      toast({
        title: 'Saved',
        description: 'Your changes have been saved.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save changes.',
        variant: 'destructive',
      });
    }
  };

  return <Button onClick={handleSave}>Save</Button>;
}
```

## Theming

### CSS Variables

The components use CSS variables for theming. Add these to your global CSS:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 47.4% 11.2%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 47.4% 11.2%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 47.4% 11.2%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
  --radius: 0.5rem;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --card-foreground: 210 40% 98%;
  --popover: 222.2 84% 4.9%;
  --popover-foreground: 210 40% 98%;
  --primary: 210 40% 98%;
  --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 217.2 32.6% 17.5%;
  --secondary-foreground: 210 40% 98%;
  --muted: 217.2 32.6% 17.5%;
  --muted-foreground: 215 20.2% 65.1%;
  --accent: 217.2 32.6% 17.5%;
  --accent-foreground: 210 40% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
  --input: 217.2 32.6% 17.5%;
  --ring: 212.7 26.8% 83.9%;
}
```

### Tailwind Configuration

Make sure your Tailwind config extends the theme:

```javascript
// tailwind.config.js
module.exports = {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
    './node_modules/@geekmidas/ui/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
};
```

## Exports

```typescript
// Components
import { Button } from '@geekmidas/ui/components/button';
import { Card } from '@geekmidas/ui/components/card';
import { Input } from '@geekmidas/ui/components/input';
import { Table } from '@geekmidas/ui/components/table';
import { Dialog } from '@geekmidas/ui/components/dialog';
// ... more components

// Hooks
import { useToast } from '@geekmidas/ui/hooks/use-toast';

// Utilities
import { cn } from '@geekmidas/ui/lib/utils';
```

## See Also

- [shadcn/ui](https://ui.shadcn.com) - Design system documentation
- [Radix UI](https://radix-ui.com) - Primitive components
- [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS
