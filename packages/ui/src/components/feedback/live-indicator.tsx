'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Pause, Play } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

const liveIndicatorVariants = cva(
  'inline-flex items-center gap-2 rounded-full text-sm font-medium',
  {
    variants: {
      size: {
        sm: 'h-6 px-2 text-xs',
        md: 'h-7 px-2.5',
        lg: 'h-8 px-3',
      },
      variant: {
        default: 'bg-surface border border-border',
        solid: '',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  },
);

export interface LiveIndicatorProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onToggle'>,
    VariantProps<typeof liveIndicatorVariants> {
  /** Whether the indicator is in live/active state */
  live?: boolean;
  /** Label to show when live */
  liveLabel?: string;
  /** Label to show when paused */
  pausedLabel?: string;
  /** Whether to show a toggle button */
  toggleable?: boolean;
  /** Callback when toggled */
  onLiveToggle?: (live: boolean) => void;
  /** Custom color for the dot when live */
  liveColor?: string;
}

const LiveIndicator = React.forwardRef<HTMLDivElement, LiveIndicatorProps>(
  (
    {
      className,
      size,
      variant,
      live = true,
      liveLabel = 'Live',
      pausedLabel = 'Paused',
      toggleable = false,
      onLiveToggle,
      liveColor = '#22c55e',
      ...props
    },
    ref,
  ) => {
    const handleToggle = () => {
      onLiveToggle?.(!live);
    };

    const dotColor = live ? liveColor : '#6b7280';
    const textColor = live ? liveColor : undefined;

    return (
      <div
        ref={ref}
        className={cn(
          liveIndicatorVariants({ size, variant, className }),
          variant === 'solid' && live && 'bg-green-500/10',
          variant === 'solid' && !live && 'bg-muted',
        )}
        {...props}
      >
        <span
          className={cn('rounded-full', live && 'animate-pulse')}
          style={{
            backgroundColor: dotColor,
            width: size === 'sm' ? 6 : size === 'lg' ? 10 : 8,
            height: size === 'sm' ? 6 : size === 'lg' ? 10 : 8,
          }}
        />
        <span style={{ color: textColor }}>
          {live ? liveLabel : pausedLabel}
        </span>
        {toggleable && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'ml-1 rounded-full',
              size === 'sm' && 'h-4 w-4',
              size === 'md' && 'h-5 w-5',
              size === 'lg' && 'h-6 w-6',
            )}
            onClick={handleToggle}
          >
            {live ? (
              <Pause
                className={cn(
                  size === 'sm' && 'h-2.5 w-2.5',
                  size === 'md' && 'h-3 w-3',
                  size === 'lg' && 'h-3.5 w-3.5',
                )}
              />
            ) : (
              <Play
                className={cn(
                  size === 'sm' && 'h-2.5 w-2.5',
                  size === 'md' && 'h-3 w-3',
                  size === 'lg' && 'h-3.5 w-3.5',
                )}
              />
            )}
          </Button>
        )}
      </div>
    );
  },
);
LiveIndicator.displayName = 'LiveIndicator';

export interface ConnectionStatusProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Connection status */
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  /** Whether to show label */
  showLabel?: boolean;
  /** Size of the indicator */
  size?: 'sm' | 'md' | 'lg';
}

const connectionStatusConfig = {
  connected: {
    color: '#22c55e',
    label: 'Connected',
    pulse: false,
  },
  connecting: {
    color: '#f59e0b',
    label: 'Connecting...',
    pulse: true,
  },
  disconnected: {
    color: '#6b7280',
    label: 'Disconnected',
    pulse: false,
  },
  error: {
    color: '#ef4444',
    label: 'Error',
    pulse: true,
  },
};

const ConnectionStatus = React.forwardRef<
  HTMLDivElement,
  ConnectionStatusProps
>(({ className, status, showLabel = true, size = 'md', ...props }, ref) => {
  const config = connectionStatusConfig[status];
  const dotSize = size === 'sm' ? 6 : size === 'lg' ? 10 : 8;

  return (
    <div
      ref={ref}
      className={cn('inline-flex items-center gap-2', className)}
      {...props}
    >
      <span
        className={cn('rounded-full', config.pulse && 'animate-pulse')}
        style={{
          backgroundColor: config.color,
          width: dotSize,
          height: dotSize,
        }}
      />
      {showLabel && (
        <span
          className={cn(
            'text-sm',
            size === 'sm' && 'text-xs',
            size === 'lg' && 'text-base',
          )}
          style={{ color: config.color }}
        >
          {config.label}
        </span>
      )}
    </div>
  );
});
ConnectionStatus.displayName = 'ConnectionStatus';

export { LiveIndicator, ConnectionStatus, liveIndicatorVariants };
