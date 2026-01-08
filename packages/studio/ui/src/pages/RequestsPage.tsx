import { HttpMethodBadge, HttpStatusBadge, NoResults } from '@geekmidas/ui';
import { ArrowLeft, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as api from '../api';
import { useStudio } from '../providers/StudioProvider';
import type { RequestEntry } from '../types';

interface RequestFilters {
	search: string;
	method: string;
	status: string;
}

export function RequestsPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { requests: realtimeRequests } = useStudio();

	const [requests, setRequests] = useState<RequestEntry[]>([]);
	const [selectedRequest, setSelectedRequest] = useState<RequestEntry | null>(
		null,
	);
	const [loading, setLoading] = useState(true);
	const [filters, setFilters] = useState<RequestFilters>({
		search: '',
		method: '',
		status: '',
	});

	// Merge realtime requests with fetched requests
	useEffect(() => {
		setRequests((prev) => {
			const existingIds = new Set(prev.map((r) => r.id));
			const newRequests = realtimeRequests.filter(
				(r) => !existingIds.has(r.id),
			);
			if (newRequests.length > 0) {
				return [...newRequests, ...prev].slice(0, 100);
			}
			return prev;
		});
	}, [realtimeRequests]);

	// Load requests
	const loadRequests = useCallback(async () => {
		try {
			setLoading(true);
			const data = await api.getRequests({
				limit: 100,
				search: filters.search || undefined,
				method: filters.method || undefined,
				status: filters.status || undefined,
			});
			setRequests(data);
		} catch (error) {
		} finally {
			setLoading(false);
		}
	}, [filters]);

	useEffect(() => {
		loadRequests();
	}, [loadRequests]);

	// Load selected request detail
	useEffect(() => {
		if (id) {
			const existing = requests.find((r) => r.id === id);
			if (existing) {
				setSelectedRequest(existing);
			} else {
				api.getRequest(id).then(setSelectedRequest).catch(console.error);
			}
		} else {
			setSelectedRequest(null);
		}
	}, [id, requests]);

	// Filter requests
	const filteredRequests = useMemo(() => {
		return requests.filter((request) => {
			if (
				filters.search &&
				!request.path.toLowerCase().includes(filters.search.toLowerCase())
			) {
				return false;
			}
			if (filters.method && request.method !== filters.method) {
				return false;
			}
			if (filters.status) {
				const statusCategory = Math.floor(request.status / 100);
				const filterCategory = parseInt(filters.status[0], 10);
				if (statusCategory !== filterCategory) {
					return false;
				}
			}
			return true;
		});
	}, [requests, filters]);

	const hasFilters = filters.search || filters.method || filters.status;

	const clearFilters = () => {
		setFilters({ search: '', method: '', status: '' });
	};

	return (
		<div className="flex h-full">
			{/* Request List */}
			<div className="flex-1 flex flex-col overflow-hidden">
				{/* Filter Bar */}
				<div className="p-4 border-b border-border bg-surface flex items-center gap-4">
					<input
						type="text"
						placeholder="Search paths..."
						value={filters.search}
						onChange={(e) =>
							setFilters((f) => ({ ...f, search: e.target.value }))
						}
						className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
					/>
					<select
						value={filters.method}
						onChange={(e) =>
							setFilters((f) => ({ ...f, method: e.target.value }))
						}
						className="bg-background border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
					>
						<option value="">All Methods</option>
						<option value="GET">GET</option>
						<option value="POST">POST</option>
						<option value="PUT">PUT</option>
						<option value="PATCH">PATCH</option>
						<option value="DELETE">DELETE</option>
					</select>
					<select
						value={filters.status}
						onChange={(e) =>
							setFilters((f) => ({ ...f, status: e.target.value }))
						}
						className="bg-background border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
					>
						<option value="">All Status</option>
						<option value="2xx">2xx Success</option>
						<option value="3xx">3xx Redirect</option>
						<option value="4xx">4xx Client Error</option>
						<option value="5xx">5xx Server Error</option>
					</select>
					{hasFilters && (
						<button
							onClick={clearFilters}
							className="text-sm text-muted-foreground hover:text-foreground"
						>
							Clear
						</button>
					)}
				</div>

				{/* Request List */}
				<div className="flex-1 overflow-auto p-4">
					{loading ? (
						<div className="flex items-center justify-center py-16 text-muted-foreground">
							Loading...
						</div>
					) : filteredRequests.length === 0 ? (
						<NoResults
							title={hasFilters ? 'No matching requests' : 'No requests yet'}
							description={
								hasFilters
									? 'Try adjusting your filters.'
									: 'Requests will appear here as they are captured.'
							}
						/>
					) : (
						<div className="flex flex-col gap-2">
							{filteredRequests.map((request) => (
								<div
									key={request.id}
									className={`bg-surface border rounded-lg p-4 cursor-pointer transition-colors hover:border-accent/50 flex items-center gap-4 ${
										selectedRequest?.id === request.id
											? 'border-accent'
											: 'border-border'
									}`}
									onClick={() => navigate(`/monitoring/requests/${request.id}`)}
								>
									<HttpMethodBadge method={request.method as any} size="sm" />
									<span className="flex-1 truncate font-mono text-sm">
										{request.path}
									</span>
									<HttpStatusBadge code={request.status} size="sm" />
									<span className="text-xs text-muted-foreground min-w-16 text-right">
										{formatDuration(request.duration)}
									</span>
									<span className="text-xs text-muted-foreground min-w-20 text-right">
										{formatTime(request.timestamp)}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Request Detail Panel */}
			{selectedRequest && (
				<RequestDetailPanel
					request={selectedRequest}
					onClose={() => navigate('/monitoring/requests')}
				/>
			)}
		</div>
	);
}

function RequestDetailPanel({
	request,
	onClose,
}: {
	request: RequestEntry;
	onClose: () => void;
}) {
	const [activeTab, setActiveTab] = useState<
		'request' | 'response' | 'headers'
	>('request');

	return (
		<div className="w-[500px] border-l border-border bg-surface flex flex-col">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b border-border">
				<div className="flex items-center gap-3">
					<button
						onClick={onClose}
						className="p-1 hover:bg-surface-hover rounded"
					>
						<ArrowLeft className="h-4 w-4" />
					</button>
					<div>
						<div className="flex items-center gap-2">
							<HttpMethodBadge method={request.method as any} size="sm" />
							<HttpStatusBadge code={request.status} size="sm" />
						</div>
						<p className="text-sm text-muted-foreground font-mono mt-1 truncate max-w-[350px]">
							{request.path}
						</p>
					</div>
				</div>
				<button
					onClick={onClose}
					className="p-1 hover:bg-surface-hover rounded"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			{/* Tabs */}
			<div className="flex border-b border-border">
				{(['request', 'response', 'headers'] as const).map((tab) => (
					<button
						key={tab}
						className={`px-4 py-2 text-sm capitalize border-b-2 transition-colors ${
							activeTab === tab
								? 'text-accent border-accent'
								: 'text-muted-foreground border-transparent hover:text-foreground'
						}`}
						onClick={() => setActiveTab(tab)}
					>
						{tab}
					</button>
				))}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-auto p-4">
				{activeTab === 'request' && (
					<div className="space-y-4">
						<InfoRow
							label="Duration"
							value={formatDuration(request.duration)}
						/>
						<InfoRow label="Time" value={formatTime(request.timestamp)} />
						{request.ip && <InfoRow label="IP" value={request.ip} />}
						{request.userAgent && (
							<InfoRow label="User Agent" value={request.userAgent} />
						)}
						{request.requestBody !== undefined &&
							request.requestBody !== null && (
								<div>
									<h4 className="text-sm font-medium mb-2">Request Body</h4>
									<pre className="bg-background rounded p-3 text-xs overflow-auto max-h-[300px]">
										{formatBody(request.requestBody)}
									</pre>
								</div>
							)}
					</div>
				)}

				{activeTab === 'response' && (
					<div className="space-y-4">
						<InfoRow label="Status" value={`${request.status}`} />
						{request.responseBody !== undefined &&
							request.responseBody !== null && (
								<div>
									<h4 className="text-sm font-medium mb-2">Response Body</h4>
									<pre className="bg-background rounded p-3 text-xs overflow-auto max-h-[400px]">
										{formatBody(request.responseBody)}
									</pre>
								</div>
							)}
					</div>
				)}

				{activeTab === 'headers' && (
					<div className="space-y-6">
						{request.requestHeaders &&
							Object.keys(request.requestHeaders).length > 0 && (
								<div>
									<h4 className="text-sm font-medium mb-2">Request Headers</h4>
									<div className="bg-background rounded p-3 space-y-1">
										{Object.entries(request.requestHeaders).map(
											([key, value]) => (
												<div key={key} className="text-xs">
													<span className="text-muted-foreground">{key}:</span>{' '}
													<span className="font-mono">{String(value)}</span>
												</div>
											),
										)}
									</div>
								</div>
							)}
						{request.responseHeaders &&
							Object.keys(request.responseHeaders).length > 0 && (
								<div>
									<h4 className="text-sm font-medium mb-2">Response Headers</h4>
									<div className="bg-background rounded p-3 space-y-1">
										{Object.entries(request.responseHeaders).map(
											([key, value]) => (
												<div key={key} className="text-xs">
													<span className="text-muted-foreground">{key}:</span>{' '}
													<span className="font-mono">{String(value)}</span>
												</div>
											),
										)}
									</div>
								</div>
							)}
					</div>
				)}
			</div>
		</div>
	);
}

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-sm text-muted-foreground w-24">{label}</span>
			<span className="text-sm font-mono">{value}</span>
		</div>
	);
}

function formatDuration(ms: number) {
	if (ms < 1) return '<1ms';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(timestamp: string) {
	return new Date(timestamp).toLocaleTimeString();
}

function formatBody(body: unknown): string {
	if (typeof body === 'string') {
		return body;
	}
	return JSON.stringify(body, null, 2);
}
