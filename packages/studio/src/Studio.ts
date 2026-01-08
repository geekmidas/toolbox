import { Telescope } from '@geekmidas/telescope';
import { DataBrowser } from './data/DataBrowser';
import type {
	NormalizedStudioOptions,
	StudioEvent,
	StudioOptions,
} from './types';

/**
 * Unified development tools dashboard combining monitoring and database browsing.
 *
 * @example
 * ```typescript
 * import { Studio, Direction } from '@geekmidas/studio';
 * import { InMemoryStorage } from '@geekmidas/telescope/storage/memory';
 *
 * const studio = new Studio({
 *   monitoring: {
 *     storage: new InMemoryStorage(),
 *   },
 *   data: {
 *     db: kyselyInstance,
 *     cursor: { field: 'id', direction: Direction.Desc },
 *   },
 * });
 * ```
 */
export class Studio<DB = unknown> {
	private telescope: Telescope;
	private dataBrowser: DataBrowser<DB>;
	private options: NormalizedStudioOptions<DB>;
	private wsClients = new Set<WebSocket>();

	constructor(options: StudioOptions<DB>) {
		this.options = this.normalizeOptions(options);

		// Initialize Telescope internally
		this.telescope = new Telescope({
			storage: this.options.monitoring.storage,
			enabled: this.options.enabled,
			path: `${this.options.path}/monitoring`,
			recordBody: this.options.monitoring.recordBody,
			maxBodySize: this.options.monitoring.maxBodySize,
			ignorePatterns: [
				...this.options.monitoring.ignorePatterns,
				`${this.options.path}/*`, // Ignore Studio's own routes
			],
			pruneAfterHours: this.options.monitoring.pruneAfterHours,
		});

		// Initialize DataBrowser
		this.dataBrowser = new DataBrowser(this.options.data);
	}

	// ============================================
	// Public API - Configuration
	// ============================================

	/**
	 * Get the Studio dashboard path.
	 */
	get path(): string {
		return this.options.path;
	}

	/**
	 * Check if Studio is enabled.
	 */
	get enabled(): boolean {
		return this.options.enabled;
	}

	/**
	 * Get the data browser instance.
	 */
	get data(): DataBrowser<DB> {
		return this.dataBrowser;
	}

	/**
	 * Check if body recording is enabled for monitoring.
	 */
	get recordBody(): boolean {
		return this.options.monitoring.recordBody;
	}

	/**
	 * Get max body size for monitoring.
	 */
	get maxBodySize(): number {
		return this.options.monitoring.maxBodySize;
	}

	// ============================================
	// Public API - Monitoring (delegated to Telescope)
	// ============================================

	/**
	 * Record a request entry.
	 */
	async recordRequest(
		entry: Parameters<Telescope['recordRequest']>[0],
	): Promise<string> {
		return this.telescope.recordRequest(entry);
	}

	/**
	 * Record log entries in batch.
	 */
	async log(entries: Parameters<Telescope['log']>[0]): Promise<void> {
		return this.telescope.log(entries);
	}

	/**
	 * Log a debug message.
	 */
	async debug(
		message: string,
		context?: Record<string, unknown>,
		requestId?: string,
	): Promise<void> {
		return this.telescope.debug(message, context, requestId);
	}

	/**
	 * Log an info message.
	 */
	async info(
		message: string,
		context?: Record<string, unknown>,
		requestId?: string,
	): Promise<void> {
		return this.telescope.info(message, context, requestId);
	}

	/**
	 * Log a warning message.
	 */
	async warn(
		message: string,
		context?: Record<string, unknown>,
		requestId?: string,
	): Promise<void> {
		return this.telescope.warn(message, context, requestId);
	}

	/**
	 * Log an error message.
	 */
	async error(
		message: string,
		context?: Record<string, unknown>,
		requestId?: string,
	): Promise<void> {
		return this.telescope.error(message, context, requestId);
	}

	/**
	 * Record an exception.
	 */
	async exception(error: Error, requestId?: string): Promise<void> {
		return this.telescope.exception(error, requestId);
	}

	/**
	 * Get requests from storage.
	 */
	async getRequests(
		options?: Parameters<Telescope['getRequests']>[0],
	): ReturnType<Telescope['getRequests']> {
		return this.telescope.getRequests(options);
	}

	/**
	 * Get a single request by ID.
	 */
	async getRequest(id: string): ReturnType<Telescope['getRequest']> {
		return this.telescope.getRequest(id);
	}

	/**
	 * Get exceptions from storage.
	 */
	async getExceptions(
		options?: Parameters<Telescope['getExceptions']>[0],
	): ReturnType<Telescope['getExceptions']> {
		return this.telescope.getExceptions(options);
	}

	/**
	 * Get a single exception by ID.
	 */
	async getException(id: string): ReturnType<Telescope['getException']> {
		return this.telescope.getException(id);
	}

	/**
	 * Get logs from storage.
	 */
	async getLogs(
		options?: Parameters<Telescope['getLogs']>[0],
	): ReturnType<Telescope['getLogs']> {
		return this.telescope.getLogs(options);
	}

	/**
	 * Get storage statistics.
	 */
	async getStats(): ReturnType<Telescope['getStats']> {
		return this.telescope.getStats();
	}

	// ============================================
	// Public API - Metrics (delegated to Telescope)
	// ============================================

	/**
	 * Get aggregated request metrics.
	 */
	getMetrics(
		options?: Parameters<Telescope['getMetrics']>[0],
	): ReturnType<Telescope['getMetrics']> {
		return this.telescope.getMetrics(options);
	}

	/**
	 * Get metrics grouped by endpoint.
	 */
	getEndpointMetrics(
		options?: Parameters<Telescope['getEndpointMetrics']>[0],
	): ReturnType<Telescope['getEndpointMetrics']> {
		return this.telescope.getEndpointMetrics(options);
	}

	/**
	 * Get detailed metrics for a specific endpoint.
	 */
	getEndpointDetails(
		method: string,
		path: string,
		options?: Parameters<Telescope['getEndpointDetails']>[2],
	): ReturnType<Telescope['getEndpointDetails']> {
		return this.telescope.getEndpointDetails(method, path, options);
	}

	/**
	 * Get HTTP status code distribution.
	 */
	getStatusDistribution(
		options?: Parameters<Telescope['getStatusDistribution']>[0],
	): ReturnType<Telescope['getStatusDistribution']> {
		return this.telescope.getStatusDistribution(options);
	}

	/**
	 * Reset all metrics.
	 */
	resetMetrics(): void {
		this.telescope.resetMetrics();
	}

	// ============================================
	// Public API - WebSocket
	// ============================================

	/**
	 * Add a WebSocket client for real-time updates.
	 */
	addWsClient(ws: WebSocket): void {
		this.wsClients.add(ws);
		// Also add to Telescope for monitoring events
		this.telescope.addWsClient(ws);
	}

	/**
	 * Remove a WebSocket client.
	 */
	removeWsClient(ws: WebSocket): void {
		this.wsClients.delete(ws);
		this.telescope.removeWsClient(ws);
	}

	/**
	 * Broadcast an event to all connected WebSocket clients.
	 */
	broadcast(event: StudioEvent): void {
		const data = JSON.stringify(event);
		for (const client of this.wsClients) {
			try {
				client.send(data);
			} catch {
				this.wsClients.delete(client);
			}
		}
	}

	// ============================================
	// Public API - Lifecycle
	// ============================================

	/**
	 * Check if a path should be ignored for request recording.
	 */
	shouldIgnore(path: string): boolean {
		// Ignore Studio's own routes
		if (path.startsWith(this.options.path)) {
			return true;
		}
		return this.telescope.shouldIgnore(path);
	}

	/**
	 * Manually prune old monitoring entries.
	 */
	async prune(olderThan: Date): Promise<number> {
		return this.telescope.prune(olderThan);
	}

	/**
	 * Clean up resources.
	 */
	destroy(): void {
		this.telescope.destroy();
		this.wsClients.clear();
	}

	// ============================================
	// Private Methods
	// ============================================

	private normalizeOptions(
		options: StudioOptions<DB>,
	): NormalizedStudioOptions<DB> {
		const path = options.path ?? '/__studio';

		return {
			monitoring: {
				storage: options.monitoring.storage,
				ignorePatterns: options.monitoring.ignorePatterns ?? [],
				recordBody: options.monitoring.recordBody ?? true,
				maxBodySize: options.monitoring.maxBodySize ?? 64 * 1024,
				pruneAfterHours: options.monitoring.pruneAfterHours ?? 24,
			},
			data: {
				db: options.data.db,
				cursor: options.data.cursor,
				tableCursors: options.data.tableCursors ?? {},
				excludeTables: options.data.excludeTables ?? [
					// Kysely
					'kysely_migration',
					'kysely_migration_lock',
					// Prisma
					'_prisma_migrations',
					// Rails/Knex
					'schema_migrations',
					// Generic
					'_migrations',
					'migrations',
				],
				defaultPageSize: Math.min(options.data.defaultPageSize ?? 50, 100),
				showBinaryColumns: options.data.showBinaryColumns ?? false,
			},
			path,
			enabled: options.enabled ?? true,
		};
	}
}
