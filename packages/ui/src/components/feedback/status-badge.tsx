'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../../lib/utils';
import {
	getLogLevelColor,
	getMethodColor,
	getStatusColor,
} from '../../styles/theme';

const statusBadgeVariants = cva(
	'inline-flex items-center justify-center rounded-full text-xs font-medium',
	{
		variants: {
			size: {
				sm: 'h-5 min-w-5 px-1.5',
				md: 'h-6 min-w-6 px-2',
				lg: 'h-7 min-w-7 px-2.5',
			},
		},
		defaultVariants: {
			size: 'md',
		},
	},
);

export interface StatusBadgeProps
	extends React.HTMLAttributes<HTMLSpanElement>,
		VariantProps<typeof statusBadgeVariants> {
	/** HTTP status code to display */
	status?: number;
	/** HTTP method to display */
	method?: string;
	/** Log level to display */
	logLevel?: string;
	/** Custom color (overrides automatic color) */
	color?: string;
	/** Whether to show a pulsing dot */
	pulse?: boolean;
}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
	(
		{
			className,
			size,
			status,
			method,
			logLevel,
			color: customColor,
			pulse,
			children,
			style,
			...props
		},
		ref,
	) => {
		// Determine color based on props
		let color = customColor;
		let content = children;

		if (status !== undefined) {
			color = color ?? getStatusColor(status);
			content = content ?? String(status);
		} else if (method) {
			color = color ?? getMethodColor(method);
			content = content ?? method.toUpperCase();
		} else if (logLevel) {
			color = color ?? getLogLevelColor(logLevel);
			content = content ?? logLevel.toUpperCase();
		}

		const backgroundColor = color ? `${color}20` : undefined;
		const textColor = color;

		return (
			<span
				ref={ref}
				className={cn(statusBadgeVariants({ size, className }))}
				style={{
					backgroundColor,
					color: textColor,
					...style,
				}}
				{...props}
			>
				{pulse && (
					<span
						className="mr-1.5 h-1.5 w-1.5 rounded-full animate-pulse"
						style={{ backgroundColor: color }}
					/>
				)}
				{content}
			</span>
		);
	},
);
StatusBadge.displayName = 'StatusBadge';

export interface HttpStatusBadgeProps
	extends Omit<StatusBadgeProps, 'status' | 'method' | 'logLevel'> {
	/** HTTP status code */
	code: number;
}

const HttpStatusBadge = React.forwardRef<HTMLSpanElement, HttpStatusBadgeProps>(
	({ code, ...props }, ref) => {
		return <StatusBadge ref={ref} status={code} {...props} />;
	},
);
HttpStatusBadge.displayName = 'HttpStatusBadge';

export interface HttpMethodBadgeProps
	extends Omit<StatusBadgeProps, 'status' | 'method' | 'logLevel'> {
	/** HTTP method */
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
}

const HttpMethodBadge = React.forwardRef<HTMLSpanElement, HttpMethodBadgeProps>(
	({ method, ...props }, ref) => {
		return <StatusBadge ref={ref} method={method} {...props} />;
	},
);
HttpMethodBadge.displayName = 'HttpMethodBadge';

export interface LogLevelBadgeProps
	extends Omit<StatusBadgeProps, 'status' | 'method' | 'logLevel'> {
	/** Log level */
	level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
}

const LogLevelBadge = React.forwardRef<HTMLSpanElement, LogLevelBadgeProps>(
	({ level, ...props }, ref) => {
		return <StatusBadge ref={ref} logLevel={level} {...props} />;
	},
);
LogLevelBadge.displayName = 'LogLevelBadge';

export {
	StatusBadge,
	HttpStatusBadge,
	HttpMethodBadge,
	LogLevelBadge,
	statusBadgeVariants,
};
