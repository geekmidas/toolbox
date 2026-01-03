'use client';
import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SplitPaneProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Direction of the split */
  direction?: 'horizontal' | 'vertical';
  /** Initial size of the first pane (in pixels or percentage) */
  defaultSize?: number | string;
  /** Minimum size of the first pane in pixels */
  minSize?: number;
  /** Maximum size of the first pane in pixels */
  maxSize?: number;
  /** Called when the pane size changes */
  onSizeChange?: (size: number) => void;
  /** Whether to show the resize handle */
  resizable?: boolean;
}

const SplitPane = React.forwardRef<HTMLDivElement, SplitPaneProps>(
  (
    {
      className,
      direction = 'horizontal',
      defaultSize = '50%',
      minSize = 100,
      maxSize,
      onSizeChange,
      resizable = true,
      children,
      ...props
    },
    ref,
  ) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [size, setSize] = React.useState<number | null>(null);
    const [isDragging, setIsDragging] = React.useState(false);

    const childArray = React.Children.toArray(children);
    const firstPane = childArray[0];
    const secondPane = childArray[1];

    const isHorizontal = direction === 'horizontal';

    // Initialize size from defaultSize
    React.useEffect(() => {
      if (size !== null || !containerRef.current) return;

      const containerSize = isHorizontal
        ? containerRef.current.offsetWidth
        : containerRef.current.offsetHeight;

      if (typeof defaultSize === 'string' && defaultSize.endsWith('%')) {
        const percent = parseFloat(defaultSize) / 100;
        setSize(Math.round(containerSize * percent));
      } else if (typeof defaultSize === 'number') {
        setSize(defaultSize);
      } else {
        setSize(Math.round(containerSize / 2));
      }
    }, [defaultSize, isHorizontal, size]);

    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent) => {
        if (!resizable) return;
        e.preventDefault();
        setIsDragging(true);
      },
      [resizable],
    );

    React.useEffect(() => {
      if (!isDragging) return;

      const handleMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return;

        const containerRect = containerRef.current.getBoundingClientRect();
        const containerSize = isHorizontal
          ? containerRect.width
          : containerRect.height;

        let newSize = isHorizontal
          ? e.clientX - containerRect.left
          : e.clientY - containerRect.top;

        // Apply constraints
        newSize = Math.max(minSize, newSize);
        if (maxSize) {
          newSize = Math.min(maxSize, newSize);
        }
        newSize = Math.min(containerSize - minSize, newSize);

        setSize(newSize);
        onSizeChange?.(newSize);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [isDragging, isHorizontal, minSize, maxSize, onSizeChange]);

    const firstPaneStyle: React.CSSProperties = {
      [isHorizontal ? 'width' : 'height']:
        size !== null ? `${size}px` : defaultSize,
      flexShrink: 0,
    };

    return (
      <div
        ref={(node) => {
          (
            containerRef as React.MutableRefObject<HTMLDivElement | null>
          ).current = node;
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className={cn(
          'flex overflow-hidden',
          isHorizontal ? 'flex-row' : 'flex-col',
          isDragging && 'cursor-col-resize select-none',
          className,
        )}
        {...props}
      >
        <div
          className={cn('overflow-auto', isHorizontal ? 'min-w-0' : 'min-h-0')}
          style={firstPaneStyle}
        >
          {firstPane}
        </div>

        {resizable && (
          <div
            className={cn(
              'flex shrink-0 items-center justify-center bg-border transition-colors',
              isHorizontal
                ? 'w-1 cursor-col-resize hover:bg-border-hover active:bg-accent'
                : 'h-1 cursor-row-resize hover:bg-border-hover active:bg-accent',
              isDragging && 'bg-accent',
            )}
            onMouseDown={handleMouseDown}
          >
            <div
              className={cn(
                'rounded-full bg-muted-foreground/50',
                isHorizontal ? 'h-8 w-1' : 'h-1 w-8',
              )}
            />
          </div>
        )}

        <div
          className={cn(
            'flex-1 overflow-auto',
            isHorizontal ? 'min-w-0' : 'min-h-0',
          )}
        >
          {secondPane}
        </div>
      </div>
    );
  },
);
SplitPane.displayName = 'SplitPane';

export interface SplitPanePanelProps
  extends React.HTMLAttributes<HTMLDivElement> {}

const SplitPanePanel = React.forwardRef<HTMLDivElement, SplitPanePanelProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('h-full w-full', className)} {...props}>
        {children}
      </div>
    );
  },
);
SplitPanePanel.displayName = 'SplitPanePanel';

export { SplitPane, SplitPanePanel };
