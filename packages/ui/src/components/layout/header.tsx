'use client';

import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';

export interface HeaderProps extends React.HTMLAttributes<HTMLElement> {
	sticky?: boolean;
}

const Header = React.forwardRef<HTMLElement, HeaderProps>(
	({ className, sticky = false, children, ...props }, ref) => {
		return (
			<header
				ref={ref}
				className={cn(
					'flex h-14 items-center gap-4 border-b border-border bg-surface px-4',
					sticky && 'sticky top-0 z-10',
					className,
				)}
				{...props}
			>
				{children}
			</header>
		);
	},
);
Header.displayName = 'Header';

export interface HeaderTitleProps
	extends React.HTMLAttributes<HTMLHeadingElement> {}

const HeaderTitle = React.forwardRef<HTMLHeadingElement, HeaderTitleProps>(
	({ className, children, ...props }, ref) => {
		return (
			<h1
				ref={ref}
				className={cn('text-lg font-semibold text-foreground', className)}
				{...props}
			>
				{children}
			</h1>
		);
	},
);
HeaderTitle.displayName = 'HeaderTitle';

export interface HeaderDescriptionProps
	extends React.HTMLAttributes<HTMLParagraphElement> {}

const HeaderDescription = React.forwardRef<
	HTMLParagraphElement,
	HeaderDescriptionProps
>(({ className, children, ...props }, ref) => {
	return (
		<p
			ref={ref}
			className={cn('text-sm text-muted-foreground', className)}
			{...props}
		>
			{children}
		</p>
	);
});
HeaderDescription.displayName = 'HeaderDescription';

export interface HeaderActionsProps
	extends React.HTMLAttributes<HTMLDivElement> {}

const HeaderActions = React.forwardRef<HTMLDivElement, HeaderActionsProps>(
	({ className, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn('ml-auto flex items-center gap-2', className)}
				{...props}
			>
				{children}
			</div>
		);
	},
);
HeaderActions.displayName = 'HeaderActions';

export interface BreadcrumbItem {
	label: string;
	href?: string;
	current?: boolean;
}

export interface HeaderBreadcrumbsProps
	extends React.HTMLAttributes<HTMLElement> {
	items: BreadcrumbItem[];
	separator?: React.ReactNode;
}

const HeaderBreadcrumbs = React.forwardRef<HTMLElement, HeaderBreadcrumbsProps>(
	({ className, items, separator, ...props }, ref) => {
		return (
			<nav
				ref={ref}
				aria-label="Breadcrumb"
				className={cn('flex items-center gap-1 text-sm', className)}
				{...props}
			>
				<ol className="flex items-center gap-1">
					{items.map((item, index) => (
						<li key={item.label} className="flex items-center gap-1">
							{index > 0 && (
								<span className="text-muted-foreground">
									{separator ?? <ChevronRight className="h-3.5 w-3.5" />}
								</span>
							)}
							{item.href && !item.current ? (
								<a
									href={item.href}
									className="text-muted-foreground hover:text-foreground transition-colors"
								>
									{item.label}
								</a>
							) : (
								<span
									className={cn(
										item.current
											? 'text-foreground font-medium'
											: 'text-muted-foreground',
									)}
									aria-current={item.current ? 'page' : undefined}
								>
									{item.label}
								</span>
							)}
						</li>
					))}
				</ol>
			</nav>
		);
	},
);
HeaderBreadcrumbs.displayName = 'HeaderBreadcrumbs';

export interface HeaderGroupProps extends React.HTMLAttributes<HTMLDivElement> {
	align?: 'start' | 'center' | 'end';
}

const HeaderGroup = React.forwardRef<HTMLDivElement, HeaderGroupProps>(
	({ className, align = 'start', children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn(
					'flex items-center gap-3',
					align === 'center' && 'justify-center',
					align === 'end' && 'justify-end ml-auto',
					className,
				)}
				{...props}
			>
				{children}
			</div>
		);
	},
);
HeaderGroup.displayName = 'HeaderGroup';

export {
	Header,
	HeaderTitle,
	HeaderDescription,
	HeaderActions,
	HeaderBreadcrumbs,
	HeaderGroup,
};
