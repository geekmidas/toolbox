import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /**
   * The content of the tooltip.
   */
  content: ReactNode;
  /**
   * The trigger element.
   */
  children: ReactNode;
  /**
   * Placement of the tooltip relative to the trigger.
   * @default 'top'
   */
  placement?: TooltipPlacement;
  /**
   * Delay before showing the tooltip (in ms).
   * @default 200
   */
  delay?: number;
  /**
   * Whether the tooltip is disabled.
   */
  disabled?: boolean;
}

export interface TooltipContentProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the tooltip.
   */
  children: ReactNode;
}

const placementStyles: Record<TooltipPlacement, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const arrowStyles: Record<TooltipPlacement, string> = {
  top: 'top-full left-1/2 -translate-x-1/2 border-t-[var(--ui-surface)] border-x-transparent border-b-transparent',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-[var(--ui-surface)] border-x-transparent border-t-transparent',
  left: 'left-full top-1/2 -translate-y-1/2 border-l-[var(--ui-surface)] border-y-transparent border-r-transparent',
  right: 'right-full top-1/2 -translate-y-1/2 border-r-[var(--ui-surface)] border-y-transparent border-l-transparent',
};

/**
 * Tooltip component for displaying additional information on hover.
 *
 * @example
 * ```tsx
 * <Tooltip content="This is a tooltip">
 *   <Button>Hover me</Button>
 * </Tooltip>
 * ```
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 200,
  disabled = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = useCallback(() => {
    if (disabled) return;
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [delay, disabled]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {isVisible && (
        <div
          role="tooltip"
          className={clsx(
            'absolute z-50',
            'px-2 py-1 text-xs',
            'rounded-[var(--ui-radius-sm)]',
            'bg-[var(--ui-surface)] text-[var(--ui-text)]',
            'border border-[var(--ui-border)]',
            'shadow-lg',
            'whitespace-nowrap',
            'animate-in fade-in zoom-in-95 duration-100',
            placementStyles[placement],
          )}
        >
          {content}
          {/* Arrow */}
          <div
            className={clsx(
              'absolute w-0 h-0',
              'border-4',
              arrowStyles[placement],
            )}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Standalone tooltip content component for custom implementations.
 */
export function TooltipContent({ children, className, ...props }: TooltipContentProps) {
  return (
    <div
      className={clsx(
        'px-2 py-1 text-xs',
        'rounded-[var(--ui-radius-sm)]',
        'bg-[var(--ui-surface)] text-[var(--ui-text)]',
        'border border-[var(--ui-border)]',
        'shadow-lg',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default Tooltip;
