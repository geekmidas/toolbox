'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';

export interface DataTableColumn<T> {
  /** Unique key for the column */
  key: string;
  /** Header label */
  header: string | React.ReactNode;
  /** Accessor function to get cell value */
  accessor?: (row: T) => React.ReactNode;
  /** Whether this column is sortable */
  sortable?: boolean;
  /** Custom cell renderer */
  cell?: (row: T, index: number) => React.ReactNode;
  /** Column width */
  width?: string | number;
  /** Alignment */
  align?: 'left' | 'center' | 'right';
  /** Custom header class */
  headerClassName?: string;
  /** Custom cell class */
  cellClassName?: string;
}

export interface DataTableProps<T>
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Array of column definitions */
  columns: DataTableColumn<T>[];
  /** Array of data items */
  data: T[];
  /** Key extractor for rows */
  getRowKey?: (row: T, index: number) => string | number;
  /** Currently sorted column */
  sortColumn?: string;
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Callback when sort changes */
  onSortChange?: (column: string, direction: 'asc' | 'desc') => void;
  /** Whether to show pagination */
  pagination?: boolean;
  /** Current page (1-indexed) */
  page?: number;
  /** Items per page */
  pageSize?: number;
  /** Total number of items (for server-side pagination) */
  totalItems?: number;
  /** Callback when page changes */
  onPageChange?: (page: number) => void;
  /** Callback when page size changes */
  onPageSizeChange?: (pageSize: number) => void;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Whether the table is loading */
  loading?: boolean;
  /** Empty state content */
  emptyState?: React.ReactNode;
  /** Row click handler */
  onRowClick?: (row: T, index: number) => void;
  /** Selected row keys */
  selectedKeys?: Set<string | number>;
  /** Striped rows */
  striped?: boolean;
  /** Hoverable rows */
  hoverable?: boolean;
  /** Compact mode */
  compact?: boolean;
}

function DataTableInner<T>(
  {
    className,
    columns,
    data,
    getRowKey = (_, index) => index,
    sortColumn,
    sortDirection,
    onSortChange,
    pagination = false,
    page = 1,
    pageSize = 10,
    totalItems,
    onPageChange,
    onPageSizeChange,
    pageSizeOptions = [10, 20, 50, 100],
    loading = false,
    emptyState,
    onRowClick,
    selectedKeys,
    striped = false,
    hoverable = true,
    compact = false,
    ...props
  }: DataTableProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const total = totalItems ?? data.length;
  const totalPages = Math.ceil(total / pageSize);

  const handleSort = (columnKey: string) => {
    if (!onSortChange) return;

    if (sortColumn === columnKey) {
      onSortChange(columnKey, sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChange(columnKey, 'asc');
    }
  };

  const getSortIcon = (columnKey: string) => {
    if (sortColumn !== columnKey) {
      return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3.5 w-3.5" />
    ) : (
      <ArrowDown className="ml-1 h-3.5 w-3.5" />
    );
  };

  const getAlignClass = (align?: 'left' | 'center' | 'right') => {
    switch (align) {
      case 'center':
        return 'text-center';
      case 'right':
        return 'text-right';
      default:
        return 'text-left';
    }
  };

  return (
    <div ref={ref} className={cn('w-full', className)} {...props}>
      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    getAlignClass(column.align),
                    column.sortable && 'cursor-pointer select-none',
                    compact ? 'py-2' : 'py-3',
                    column.headerClassName,
                  )}
                  style={{ width: column.width }}
                  onClick={
                    column.sortable ? () => handleSort(column.key) : undefined
                  }
                >
                  <div
                    className={cn(
                      'flex items-center',
                      column.align === 'center' && 'justify-center',
                      column.align === 'right' && 'justify-end',
                    )}
                  >
                    {column.header}
                    {column.sortable && getSortIcon(column.key)}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyState ?? 'No data available'}
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, rowIndex) => {
                const rowKey = getRowKey(row, rowIndex);
                const isSelected = selectedKeys?.has(rowKey);

                return (
                  <TableRow
                    key={rowKey}
                    className={cn(
                      striped && rowIndex % 2 === 1 && 'bg-surface/50',
                      hoverable && 'hover:bg-surface-hover cursor-pointer',
                      isSelected && 'bg-accent/10',
                      onRowClick && 'cursor-pointer',
                    )}
                    onClick={
                      onRowClick ? () => onRowClick(row, rowIndex) : undefined
                    }
                  >
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          getAlignClass(column.align),
                          compact ? 'py-2' : 'py-3',
                          column.cellClassName,
                        )}
                      >
                        {column.cell
                          ? column.cell(row, rowIndex)
                          : column.accessor
                            ? column.accessor(row)
                            : ((row as Record<string, unknown>)[
                                column.key
                              ] as React.ReactNode)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && totalPages > 0 && (
        <div className="flex items-center justify-between px-2 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange?.(Number(value))}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => onPageChange?.(1)}
                disabled={page <= 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => onPageChange?.(page - 1)}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => onPageChange?.(page + 1)}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => onPageChange?.(totalPages)}
                disabled={page >= totalPages}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const DataTable = React.forwardRef(DataTableInner) as <T>(
  props: DataTableProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> },
) => React.ReactElement;
