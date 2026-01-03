'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../../lib/utils';

const timelineVariants = cva('relative', {
  variants: {
    orientation: {
      vertical: 'flex flex-col',
      horizontal: 'flex flex-row',
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

export interface TimelineProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof timelineVariants> {}

const Timeline = React.forwardRef<HTMLDivElement, TimelineProps>(
  ({ className, orientation = 'vertical', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(timelineVariants({ orientation, className }))}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Timeline.displayName = 'Timeline';

const timelineItemVariants = cva('relative flex', {
  variants: {
    orientation: {
      vertical: 'flex-row gap-4 pb-8 last:pb-0',
      horizontal: 'flex-col gap-2 pr-8 last:pr-0',
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

export interface TimelineItemProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof timelineItemVariants> {
  /** Whether this is the active/current item */
  active?: boolean;
}

const TimelineItem = React.forwardRef<HTMLDivElement, TimelineItemProps>(
  (
    { className, orientation = 'vertical', active, children, ...props },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(timelineItemVariants({ orientation, className }))}
        data-active={active}
        {...props}
      >
        {children}
      </div>
    );
  },
);
TimelineItem.displayName = 'TimelineItem';

const timelineIndicatorVariants = cva(
  'flex items-center justify-center rounded-full border-2 shrink-0',
  {
    variants: {
      size: {
        sm: 'h-3 w-3',
        md: 'h-4 w-4',
        lg: 'h-6 w-6',
      },
      variant: {
        default: 'border-border bg-surface',
        primary: 'border-accent bg-accent',
        success: 'border-green-500 bg-green-500',
        warning: 'border-amber-500 bg-amber-500',
        error: 'border-red-500 bg-red-500',
        info: 'border-blue-500 bg-blue-500',
        muted: 'border-muted-foreground bg-muted',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  },
);

export interface TimelineIndicatorProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof timelineIndicatorVariants> {
  /** Whether to show a connecting line */
  showLine?: boolean;
  /** Line position */
  linePosition?: 'before' | 'after' | 'both';
  /** Orientation (inherited from Timeline) */
  orientation?: 'vertical' | 'horizontal';
}

const TimelineIndicator = React.forwardRef<
  HTMLDivElement,
  TimelineIndicatorProps
>(
  (
    {
      className,
      size,
      variant,
      showLine = true,
      linePosition = 'after',
      orientation = 'vertical',
      children,
      ...props
    },
    ref,
  ) => {
    const isVertical = orientation === 'vertical';

    return (
      <div
        ref={ref}
        className={cn(
          'relative flex items-center',
          isVertical ? 'flex-col' : 'flex-row',
        )}
      >
        {showLine && (linePosition === 'before' || linePosition === 'both') && (
          <div
            className={cn(
              'bg-border',
              isVertical ? 'w-0.5 flex-1' : 'h-0.5 flex-1',
            )}
          />
        )}
        <div
          className={cn(
            timelineIndicatorVariants({ size, variant, className }),
          )}
          {...props}
        >
          {children}
        </div>
        {showLine && (linePosition === 'after' || linePosition === 'both') && (
          <div
            className={cn(
              'bg-border',
              isVertical ? 'w-0.5 flex-1' : 'h-0.5 flex-1',
            )}
          />
        )}
      </div>
    );
  },
);
TimelineIndicator.displayName = 'TimelineIndicator';

export interface TimelineConnectorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Orientation (inherited from Timeline) */
  orientation?: 'vertical' | 'horizontal';
}

const TimelineConnector = React.forwardRef<
  HTMLDivElement,
  TimelineConnectorProps
>(({ className, orientation = 'vertical', ...props }, ref) => {
  const isVertical = orientation === 'vertical';

  return (
    <div
      ref={ref}
      className={cn(
        'bg-border',
        isVertical
          ? 'absolute left-[7px] top-4 bottom-0 w-0.5'
          : 'absolute top-[7px] left-4 right-0 h-0.5',
        className,
      )}
      {...props}
    />
  );
});
TimelineConnector.displayName = 'TimelineConnector';

export interface TimelineContentProps
  extends React.HTMLAttributes<HTMLDivElement> {}

const TimelineContent = React.forwardRef<HTMLDivElement, TimelineContentProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('flex-1 pt-0.5', className)} {...props}>
        {children}
      </div>
    );
  },
);
TimelineContent.displayName = 'TimelineContent';

export interface TimelineTitleProps
  extends React.HTMLAttributes<HTMLHeadingElement> {}

const TimelineTitle = React.forwardRef<HTMLHeadingElement, TimelineTitleProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <h4
        ref={ref}
        className={cn('text-sm font-medium text-foreground', className)}
        {...props}
      >
        {children}
      </h4>
    );
  },
);
TimelineTitle.displayName = 'TimelineTitle';

export interface TimelineDescriptionProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

const TimelineDescription = React.forwardRef<
  HTMLParagraphElement,
  TimelineDescriptionProps
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
TimelineDescription.displayName = 'TimelineDescription';

export interface TimelineTimeProps
  extends React.HTMLAttributes<HTMLSpanElement> {}

const TimelineTime = React.forwardRef<HTMLSpanElement, TimelineTimeProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn('text-xs text-muted-foreground', className)}
        {...props}
      >
        {children}
      </span>
    );
  },
);
TimelineTime.displayName = 'TimelineTime';

export {
  Timeline,
  TimelineItem,
  TimelineIndicator,
  TimelineConnector,
  TimelineContent,
  TimelineTitle,
  TimelineDescription,
  TimelineTime,
  timelineVariants,
  timelineItemVariants,
  timelineIndicatorVariants,
};
