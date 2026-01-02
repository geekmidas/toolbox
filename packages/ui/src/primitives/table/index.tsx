import { clsx } from 'clsx';
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes, ReactNode } from 'react';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /**
   * The content of the table.
   */
  children: ReactNode;
}

export interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> {
  /**
   * The content of the table header.
   */
  children: ReactNode;
}

export interface TableBodyProps extends HTMLAttributes<HTMLTableSectionElement> {
  /**
   * The content of the table body.
   */
  children: ReactNode;
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /**
   * The content of the table row.
   */
  children: ReactNode;
  /**
   * Whether the row is clickable.
   */
  clickable?: boolean;
  /**
   * Whether the row is selected.
   */
  selected?: boolean;
}

export interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /**
   * The content of the table header cell.
   */
  children?: ReactNode;
  /**
   * Whether the column is sortable.
   */
  sortable?: boolean;
  /**
   * Current sort direction.
   */
  sortDirection?: 'asc' | 'desc' | null;
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /**
   * The content of the table cell.
   */
  children?: ReactNode;
}

/**
 * Table component for displaying tabular data.
 *
 * @example
 * ```tsx
 * <Table>
 *   <TableHeader>
 *     <TableRow>
 *       <TableHead>Name</TableHead>
 *       <TableHead>Status</TableHead>
 *     </TableRow>
 *   </TableHeader>
 *   <TableBody>
 *     <TableRow>
 *       <TableCell>John Doe</TableCell>
 *       <TableCell>Active</TableCell>
 *     </TableRow>
 *   </TableBody>
 * </Table>
 * ```
 */
export function Table({ children, className, ...props }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table
        className={clsx(
          'w-full border-collapse',
          'text-sm text-[var(--ui-text)]',
          className,
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

/**
 * Table header section.
 */
export function TableHeader({ children, className, ...props }: TableHeaderProps) {
  return (
    <thead
      className={clsx(
        'bg-[var(--ui-surface)]',
        'border-b border-[var(--ui-border)]',
        className,
      )}
      {...props}
    >
      {children}
    </thead>
  );
}

/**
 * Table body section.
 */
export function TableBody({ children, className, ...props }: TableBodyProps) {
  return (
    <tbody
      className={clsx(
        '[&>tr:last-child]:border-b-0',
        className,
      )}
      {...props}
    >
      {children}
    </tbody>
  );
}

/**
 * Table row.
 */
export function TableRow({
  children,
  clickable = false,
  selected = false,
  className,
  ...props
}: TableRowProps) {
  return (
    <tr
      className={clsx(
        'border-b border-[var(--ui-border)]',
        'transition-colors duration-[var(--ui-transition-fast)]',
        clickable && 'cursor-pointer hover:bg-[var(--ui-surface-hover)]',
        selected && 'bg-[var(--ui-accent)]/5',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

/**
 * Table header cell.
 */
export function TableHead({
  children,
  sortable = false,
  sortDirection = null,
  className,
  ...props
}: TableHeadProps) {
  return (
    <th
      className={clsx(
        'px-4 py-3 text-left font-medium text-[var(--ui-text-muted)]',
        'whitespace-nowrap',
        sortable && 'cursor-pointer select-none hover:text-[var(--ui-text)]',
        className,
      )}
      {...props}
    >
      <div className="inline-flex items-center gap-1">
        {children}
        {sortable && sortDirection && (
          <svg
            className={clsx(
              'w-4 h-4',
              sortDirection === 'desc' && 'rotate-180',
            )}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
    </th>
  );
}

/**
 * Table data cell.
 */
export function TableCell({ children, className, ...props }: TableCellProps) {
  return (
    <td
      className={clsx(
        'px-4 py-3',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

export default Table;
