'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ShellProps extends React.HTMLAttributes<HTMLDivElement> {}

const Shell = React.forwardRef<HTMLDivElement, ShellProps>(
	({ className, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn('flex h-screen w-full bg-background', className)}
				{...props}
			>
				{children}
			</div>
		);
	},
);
Shell.displayName = 'Shell';

export interface ShellSidebarProps
	extends React.HTMLAttributes<HTMLDivElement> {}

const ShellSidebar = React.forwardRef<HTMLDivElement, ShellSidebarProps>(
	({ className, children, ...props }, ref) => {
		return (
			<div ref={ref} className={cn('shrink-0', className)} {...props}>
				{children}
			</div>
		);
	},
);
ShellSidebar.displayName = 'ShellSidebar';

export interface ShellMainProps extends React.HTMLAttributes<HTMLDivElement> {}

const ShellMain = React.forwardRef<HTMLDivElement, ShellMainProps>(
	({ className, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn('flex flex-1 flex-col overflow-hidden', className)}
				{...props}
			>
				{children}
			</div>
		);
	},
);
ShellMain.displayName = 'ShellMain';

export interface ShellHeaderProps
	extends React.HTMLAttributes<HTMLDivElement> {}

const ShellHeader = React.forwardRef<HTMLDivElement, ShellHeaderProps>(
	({ className, children, ...props }, ref) => {
		return (
			<div ref={ref} className={cn('shrink-0', className)} {...props}>
				{children}
			</div>
		);
	},
);
ShellHeader.displayName = 'ShellHeader';

export interface ShellContentProps
	extends React.HTMLAttributes<HTMLDivElement> {
	scrollable?: boolean;
}

const ShellContent = React.forwardRef<HTMLDivElement, ShellContentProps>(
	({ className, scrollable = true, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn('flex-1', scrollable && 'overflow-auto', className)}
				{...props}
			>
				{children}
			</div>
		);
	},
);
ShellContent.displayName = 'ShellContent';

export interface ShellFooterProps
	extends React.HTMLAttributes<HTMLDivElement> {}

const ShellFooter = React.forwardRef<HTMLDivElement, ShellFooterProps>(
	({ className, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn('shrink-0 border-t border-border bg-surface', className)}
				{...props}
			>
				{children}
			</div>
		);
	},
);
ShellFooter.displayName = 'ShellFooter';

export {
	Shell,
	ShellSidebar,
	ShellMain,
	ShellHeader,
	ShellContent,
	ShellFooter,
};
