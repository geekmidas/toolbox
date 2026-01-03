'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';

const spinnerVariants = cva('animate-spin text-muted-foreground', {
  variants: {
    size: {
      xs: 'h-3 w-3',
      sm: 'h-4 w-4',
      md: 'h-6 w-6',
      lg: 'h-8 w-8',
      xl: 'h-12 w-12',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export interface SpinnerProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, 'children'>,
    VariantProps<typeof spinnerVariants> {}

const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, size, ...props }, ref) => {
    return (
      <Loader2
        ref={ref}
        className={cn(spinnerVariants({ size, className }))}
        {...props}
      />
    );
  },
);
Spinner.displayName = 'Spinner';

const loadingOverlayVariants = cva(
  'absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm',
  {
    variants: {
      variant: {
        default: 'bg-background/80',
        dark: 'bg-background/90',
        light: 'bg-background/50',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface LoadingOverlayProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof loadingOverlayVariants> {
  /** Whether the overlay is visible */
  loading?: boolean;
  /** Text to display below spinner */
  text?: string;
  /** Spinner size */
  spinnerSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const LoadingOverlay = React.forwardRef<HTMLDivElement, LoadingOverlayProps>(
  (
    {
      className,
      variant,
      loading = true,
      text,
      spinnerSize = 'lg',
      children,
      ...props
    },
    ref,
  ) => {
    if (!loading) return null;

    return (
      <div
        ref={ref}
        className={cn(loadingOverlayVariants({ variant, className }))}
        {...props}
      >
        <div className="flex flex-col items-center gap-3">
          <Spinner size={spinnerSize} />
          {text && (
            <span className="text-sm text-muted-foreground">{text}</span>
          )}
          {children}
        </div>
      </div>
    );
  },
);
LoadingOverlay.displayName = 'LoadingOverlay';

export interface LoadingContainerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether the container is loading */
  loading?: boolean;
  /** Text to display below spinner */
  loadingText?: string;
  /** Spinner size */
  spinnerSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Overlay variant */
  overlayVariant?: 'default' | 'dark' | 'light';
}

const LoadingContainer = React.forwardRef<
  HTMLDivElement,
  LoadingContainerProps
>(
  (
    {
      className,
      loading = false,
      loadingText,
      spinnerSize,
      overlayVariant,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <div ref={ref} className={cn('relative', className)} {...props}>
        {children}
        <LoadingOverlay
          loading={loading}
          text={loadingText}
          spinnerSize={spinnerSize}
          variant={overlayVariant}
        />
      </div>
    );
  },
);
LoadingContainer.displayName = 'LoadingContainer';

export interface LoadingDotsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size of dots */
  size?: 'sm' | 'md' | 'lg';
}

const LoadingDots = React.forwardRef<HTMLDivElement, LoadingDotsProps>(
  ({ className, size = 'md', ...props }, ref) => {
    const dotSize =
      size === 'sm' ? 'h-1 w-1' : size === 'lg' ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5';
    const gap = size === 'sm' ? 'gap-1' : size === 'lg' ? 'gap-2' : 'gap-1.5';

    return (
      <div
        ref={ref}
        className={cn('flex items-center', gap, className)}
        {...props}
      >
        <span
          className={cn(
            dotSize,
            'rounded-full bg-muted-foreground animate-bounce',
          )}
          style={{ animationDelay: '0ms' }}
        />
        <span
          className={cn(
            dotSize,
            'rounded-full bg-muted-foreground animate-bounce',
          )}
          style={{ animationDelay: '150ms' }}
        />
        <span
          className={cn(
            dotSize,
            'rounded-full bg-muted-foreground animate-bounce',
          )}
          style={{ animationDelay: '300ms' }}
        />
      </div>
    );
  },
);
LoadingDots.displayName = 'LoadingDots';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Width of the skeleton */
  width?: string | number;
  /** Height of the skeleton */
  height?: string | number;
  /** Whether to use rounded corners */
  rounded?: boolean | 'sm' | 'md' | 'lg' | 'full';
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, width, height, rounded = 'md', style, ...props }, ref) => {
    const roundedClass =
      rounded === true
        ? 'rounded-md'
        : rounded === false
          ? ''
          : rounded === 'sm'
            ? 'rounded-sm'
            : rounded === 'lg'
              ? 'rounded-lg'
              : rounded === 'full'
                ? 'rounded-full'
                : 'rounded-md';

    return (
      <div
        ref={ref}
        className={cn('animate-pulse bg-muted', roundedClass, className)}
        style={{
          width,
          height,
          ...style,
        }}
        {...props}
      />
    );
  },
);
Skeleton.displayName = 'Skeleton';

export {
  Spinner,
  LoadingOverlay,
  LoadingContainer,
  LoadingDots,
  Skeleton,
  spinnerVariants,
  loadingOverlayVariants,
};
