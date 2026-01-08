import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { DataTable, type DataTableColumn } from './data-table';

const meta: Meta<typeof DataTable> = {
	title: 'Data Display/DataTable',
	component: DataTable,
	tags: ['autodocs'],
	parameters: {
		layout: 'padded',
	},
};

export default meta;
type Story = StoryObj<typeof DataTable>;

interface User {
	id: number;
	name: string;
	email: string;
	role: string;
	status: 'active' | 'inactive' | 'pending';
	createdAt: string;
}

const users: User[] = Array.from({ length: 50 }, (_, i) => ({
	id: i + 1,
	name: `User ${i + 1}`,
	email: `user${i + 1}@example.com`,
	role: ['Admin', 'User', 'Editor', 'Viewer'][i % 4] as string,
	status: (['active', 'inactive', 'pending'] as const)[i % 3],
	createdAt: new Date(Date.now() - i * 86400000)
		.toISOString()
		.split('T')[0] as string,
}));

const columns: DataTableColumn<User>[] = [
	{
		key: 'id',
		header: 'ID',
		width: 60,
		sortable: true,
	},
	{
		key: 'name',
		header: 'Name',
		sortable: true,
	},
	{
		key: 'email',
		header: 'Email',
		sortable: true,
	},
	{
		key: 'role',
		header: 'Role',
		sortable: true,
	},
	{
		key: 'status',
		header: 'Status',
		sortable: true,
		cell: (row) => (
			<Badge
				variant={
					row.status === 'active'
						? 'success'
						: row.status === 'inactive'
							? 'secondary'
							: 'warning'
				}
			>
				{row.status}
			</Badge>
		),
	},
	{
		key: 'createdAt',
		header: 'Created',
		sortable: true,
		align: 'right',
	},
];

export const Default: Story = {
	render: () => <DataTable columns={columns} data={users.slice(0, 10)} />,
};

export const WithSorting: Story = {
	render: function SortableTable() {
		const [sortColumn, setSortColumn] = useState<string>('id');
		const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

		const sortedData = [...users].slice(0, 10).sort((a, b) => {
			const aVal = a[sortColumn as keyof User];
			const bVal = b[sortColumn as keyof User];

			if (typeof aVal === 'string' && typeof bVal === 'string') {
				return sortDirection === 'asc'
					? aVal.localeCompare(bVal)
					: bVal.localeCompare(aVal);
			}

			if (typeof aVal === 'number' && typeof bVal === 'number') {
				return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
			}

			return 0;
		});

		return (
			<DataTable
				columns={columns}
				data={sortedData}
				sortColumn={sortColumn}
				sortDirection={sortDirection}
				onSortChange={(column, direction) => {
					setSortColumn(column);
					setSortDirection(direction);
				}}
			/>
		);
	},
};

export const WithPagination: Story = {
	render: function PaginatedTable() {
		const [page, setPage] = useState(1);
		const [pageSize, setPageSize] = useState(10);

		const startIndex = (page - 1) * pageSize;
		const paginatedData = users.slice(startIndex, startIndex + pageSize);

		return (
			<DataTable
				columns={columns}
				data={paginatedData}
				pagination
				page={page}
				pageSize={pageSize}
				totalItems={users.length}
				onPageChange={setPage}
				onPageSizeChange={(size) => {
					setPageSize(size);
					setPage(1);
				}}
			/>
		);
	},
};

export const WithSortingAndPagination: Story = {
	render: function FullFeaturedTable() {
		const [page, setPage] = useState(1);
		const [pageSize, setPageSize] = useState(10);
		const [sortColumn, setSortColumn] = useState<string>('id');
		const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

		const sortedData = [...users].sort((a, b) => {
			const aVal = a[sortColumn as keyof User];
			const bVal = b[sortColumn as keyof User];

			if (typeof aVal === 'string' && typeof bVal === 'string') {
				return sortDirection === 'asc'
					? aVal.localeCompare(bVal)
					: bVal.localeCompare(aVal);
			}

			if (typeof aVal === 'number' && typeof bVal === 'number') {
				return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
			}

			return 0;
		});

		const startIndex = (page - 1) * pageSize;
		const paginatedData = sortedData.slice(startIndex, startIndex + pageSize);

		return (
			<DataTable
				columns={columns}
				data={paginatedData}
				sortColumn={sortColumn}
				sortDirection={sortDirection}
				onSortChange={(column, direction) => {
					setSortColumn(column);
					setSortDirection(direction);
				}}
				pagination
				page={page}
				pageSize={pageSize}
				totalItems={users.length}
				onPageChange={setPage}
				onPageSizeChange={(size) => {
					setPageSize(size);
					setPage(1);
				}}
			/>
		);
	},
};

export const Striped: Story = {
	render: () => (
		<DataTable columns={columns} data={users.slice(0, 10)} striped />
	),
};

export const Compact: Story = {
	render: () => (
		<DataTable columns={columns} data={users.slice(0, 10)} compact />
	),
};

export const Loading: Story = {
	render: () => <DataTable columns={columns} data={[]} loading />,
};

export const Empty: Story = {
	render: () => (
		<DataTable
			columns={columns}
			data={[]}
			emptyState={
				<div className="flex flex-col items-center gap-2">
					<span className="text-lg font-medium">No users found</span>
					<span className="text-sm text-muted-foreground">
						Try adjusting your search or filters
					</span>
				</div>
			}
		/>
	),
};

export const Clickable: Story = {
	render: function ClickableTable() {
		const [selectedId, setSelectedId] = useState<number | null>(null);

		return (
			<div className="space-y-4">
				<DataTable
					columns={columns}
					data={users.slice(0, 10)}
					onRowClick={(row) => setSelectedId(row.id)}
					selectedKeys={selectedId ? new Set([selectedId]) : undefined}
					getRowKey={(row) => row.id}
				/>
				{selectedId && (
					<div className="p-4 rounded-md bg-surface border border-border">
						Selected user ID: {selectedId}
					</div>
				)}
			</div>
		);
	},
};

interface Request {
	id: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	path: string;
	status: number;
	duration: number;
	timestamp: string;
}

const requests: Request[] = Array.from({ length: 20 }, (_, i) => ({
	id: `req_${i + 1}`,
	method: (['GET', 'POST', 'PUT', 'DELETE'] as const)[i % 4],
	path: `/api/${['users', 'posts', 'comments', 'products'][i % 4]}${i % 3 === 0 ? '' : `/${i}`}`,
	status: [200, 201, 400, 404, 500][i % 5] as number,
	duration: Math.floor(Math.random() * 300) + 20,
	timestamp: new Date(Date.now() - i * 60000).toISOString(),
}));

const requestColumns: DataTableColumn<Request>[] = [
	{
		key: 'method',
		header: 'Method',
		width: 80,
		cell: (row) => (
			<Badge
				variant={row.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'}
			>
				{row.method}
			</Badge>
		),
	},
	{
		key: 'path',
		header: 'Path',
		cell: (row) => <span className="font-mono text-sm">{row.path}</span>,
	},
	{
		key: 'status',
		header: 'Status',
		width: 80,
		align: 'center',
		cell: (row) => (
			<Badge
				variant={
					row.status >= 500
						? 'destructive'
						: row.status >= 400
							? 'warning'
							: 'success'
				}
			>
				{row.status}
			</Badge>
		),
	},
	{
		key: 'duration',
		header: 'Duration',
		width: 100,
		align: 'right',
		sortable: true,
		cell: (row) => (
			<span className="text-muted-foreground">{row.duration}ms</span>
		),
	},
	{
		key: 'timestamp',
		header: 'Time',
		width: 120,
		align: 'right',
		sortable: true,
		cell: (row) => (
			<span className="text-muted-foreground text-sm">
				{new Date(row.timestamp).toLocaleTimeString()}
			</span>
		),
	},
];

export const RequestsTable: Story = {
	render: () => (
		<DataTable
			columns={requestColumns}
			data={requests}
			getRowKey={(row) => row.id}
			hoverable
		/>
	),
};
