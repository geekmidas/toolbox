import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode, MouseEvent as ReactMouseEvent } from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitPaneProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the split pane.
   */
  children: [ReactNode, ReactNode];
  /**
   * Direction of the split.
   * @default 'horizontal'
   */
  direction?: SplitDirection;
  /**
   * Initial size of the first pane in pixels or percentage.
   * @default '50%'
   */
  defaultSize?: number | string;
  /**
   * Minimum size of the first pane in pixels.
   * @default 100
   */
  minSize?: number;
  /**
   * Maximum size of the first pane in pixels.
   */
  maxSize?: number;
  /**
   * Whether the split can be resized.
   * @default true
   */
  resizable?: boolean;
  /**
   * Callback when the size changes.
   */
  onResize?: (size: number) => void;
}

export interface SplitPanePanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The content of the panel.
   */
  children: ReactNode;
}

/**
 * Split pane component for resizable layouts.
 *
 * @example
 * ```tsx
 * <SplitPane direction="horizontal" defaultSize="300px">
 *   <SplitPanePanel>Left content</SplitPanePanel>
 *   <SplitPanePanel>Right content</SplitPanePanel>
 * </SplitPane>
 * ```
 */
export function SplitPane({
  children,
  direction = 'horizontal',
  defaultSize = '50%',
  minSize = 100,
  maxSize,
  resizable = true,
  onResize,
  className,
  ...props
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Initialize size from defaultSize
  useEffect(() => {
    if (containerRef.current && size === null) {
      const containerSize =
        direction === 'horizontal'
          ? containerRef.current.offsetWidth
          : containerRef.current.offsetHeight;

      if (typeof defaultSize === 'string' && defaultSize.endsWith('%')) {
        const percentage = parseFloat(defaultSize) / 100;
        setSize(Math.floor(containerSize * percentage));
      } else if (typeof defaultSize === 'string' && defaultSize.endsWith('px')) {
        setSize(parseInt(defaultSize, 10));
      } else if (typeof defaultSize === 'number') {
        setSize(defaultSize);
      } else {
        setSize(Math.floor(containerSize / 2));
      }
    }
  }, [defaultSize, direction, size]);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (!resizable) return;
      e.preventDefault();
      setIsDragging(true);
    },
    [resizable],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      let newSize: number;

      if (direction === 'horizontal') {
        newSize = e.clientX - containerRect.left;
      } else {
        newSize = e.clientY - containerRect.top;
      }

      // Apply constraints
      newSize = Math.max(minSize, newSize);
      if (maxSize !== undefined) {
        newSize = Math.min(maxSize, newSize);
      }

      const containerSize =
        direction === 'horizontal'
          ? containerRef.current.offsetWidth
          : containerRef.current.offsetHeight;
      newSize = Math.min(newSize, containerSize - minSize);

      setSize(newSize);
      onResize?.(newSize);
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
  }, [isDragging, direction, minSize, maxSize, onResize]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={clsx(
        'flex overflow-hidden',
        isHorizontal ? 'flex-row' : 'flex-col',
        isDragging && 'select-none',
        className,
      )}
      {...props}
    >
      {/* First pane */}
      <div
        className="overflow-auto shrink-0"
        style={{
          [isHorizontal ? 'width' : 'height']: size ?? undefined,
        }}
      >
        {children[0]}
      </div>

      {/* Resizer */}
      {resizable && (
        <div
          className={clsx(
            'shrink-0',
            'bg-[var(--ui-border)]',
            'transition-colors duration-[var(--ui-transition-fast)]',
            'hover:bg-[var(--ui-accent)]',
            isDragging && 'bg-[var(--ui-accent)]',
            isHorizontal
              ? 'w-1 cursor-col-resize'
              : 'h-1 cursor-row-resize',
          )}
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Second pane */}
      <div className="flex-1 overflow-auto">{children[1]}</div>
    </div>
  );
}

/**
 * Panel component for split pane content.
 */
export function SplitPanePanel({ children, className, ...props }: SplitPanePanelProps) {
  return (
    <div className={clsx('h-full', className)} {...props}>
      {children}
    </div>
  );
}

export default SplitPane;
