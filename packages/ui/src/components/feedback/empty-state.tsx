'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import { FileQuestion, Inbox, Search, ServerOff } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

const emptyStateVariants = cva(
  'flex flex-col items-center justify-center text-center',
  {
    variants: {
      size: {
        sm: 'gap-2 p-4',
        md: 'gap-3 p-6',
        lg: 'gap-4 p-8',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof emptyStateVariants> {
  /** Icon to display */
  icon?: React.ReactNode;
  /** Title text */
  title?: string;
  /** Description text */
  description?: string;
  /** Primary action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Secondary action button */
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    {
      className,
      size,
      icon,
      title,
      description,
      action,
      secondaryAction,
      children,
      ...props
    },
    ref,
  ) => {
    const iconSize =
      size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-16 w-16' : 'h-12 w-12';

    return (
      <div
        ref={ref}
        className={cn(emptyStateVariants({ size, className }))}
        {...props}
      >
        {icon && (
          <div className={cn('text-muted-foreground', iconSize)}>{icon}</div>
        )}
        {title && (
          <h3
            className={cn(
              'font-semibold text-foreground',
              size === 'sm' && 'text-sm',
              size === 'lg' && 'text-xl',
            )}
          >
            {title}
          </h3>
        )}
        {description && (
          <p
            className={cn(
              'text-muted-foreground max-w-sm',
              size === 'sm' && 'text-xs',
              size === 'lg' && 'text-base',
              !size && 'text-sm',
            )}
          >
            {description}
          </p>
        )}
        {children}
        {(action || secondaryAction) && (
          <div className="flex items-center gap-2 mt-2">
            {action && (
              <Button
                size={size === 'sm' ? 'sm' : size === 'lg' ? 'default' : 'sm'}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            )}
            {secondaryAction && (
              <Button
                variant="outline"
                size={size === 'sm' ? 'sm' : size === 'lg' ? 'default' : 'sm'}
                onClick={secondaryAction.onClick}
              >
                {secondaryAction.label}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  },
);
EmptyState.displayName = 'EmptyState';

// Preset empty states for common use cases

export interface NoDataProps extends Omit<EmptyStateProps, 'icon' | 'title'> {
  title?: string;
}

const NoData = React.forwardRef<HTMLDivElement, NoDataProps>(
  ({ title = 'No data', ...props }, ref) => {
    return (
      <EmptyState
        ref={ref}
        icon={<Inbox className="h-full w-full" />}
        title={title}
        {...props}
      />
    );
  },
);
NoData.displayName = 'NoData';

export interface NoResultsProps
  extends Omit<EmptyStateProps, 'icon' | 'title'> {
  title?: string;
  searchTerm?: string;
}

const NoResults = React.forwardRef<HTMLDivElement, NoResultsProps>(
  ({ title = 'No results found', searchTerm, description, ...props }, ref) => {
    const desc =
      description ??
      (searchTerm
        ? `No results found for "${searchTerm}". Try adjusting your search.`
        : 'Try adjusting your search or filters.');

    return (
      <EmptyState
        ref={ref}
        icon={<Search className="h-full w-full" />}
        title={title}
        description={desc}
        {...props}
      />
    );
  },
);
NoResults.displayName = 'NoResults';

export interface NotFoundProps extends Omit<EmptyStateProps, 'icon' | 'title'> {
  title?: string;
}

const NotFound = React.forwardRef<HTMLDivElement, NotFoundProps>(
  (
    {
      title = 'Page not found',
      description = "The page you're looking for doesn't exist or has been moved.",
      ...props
    },
    ref,
  ) => {
    return (
      <EmptyState
        ref={ref}
        icon={<FileQuestion className="h-full w-full" />}
        title={title}
        description={description}
        {...props}
      />
    );
  },
);
NotFound.displayName = 'NotFound';

export interface ServerErrorProps
  extends Omit<EmptyStateProps, 'icon' | 'title'> {
  title?: string;
}

const ServerError = React.forwardRef<HTMLDivElement, ServerErrorProps>(
  (
    {
      title = 'Something went wrong',
      description = 'An unexpected error occurred. Please try again later.',
      ...props
    },
    ref,
  ) => {
    return (
      <EmptyState
        ref={ref}
        icon={<ServerOff className="h-full w-full" />}
        title={title}
        description={description}
        {...props}
      />
    );
  },
);
ServerError.displayName = 'ServerError';

export {
  EmptyState,
  NoData,
  NoResults,
  NotFound,
  ServerError,
  emptyStateVariants,
};
