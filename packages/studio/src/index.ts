// Core

// Re-export Telescope storage types for convenience
// Users should import storage from @geekmidas/studio, not @geekmidas/telescope
export type { TelescopeStorage as MonitoringStorage } from '@geekmidas/telescope';
// Re-export InMemoryStorage as InMemoryMonitoringStorage
export { InMemoryStorage as InMemoryMonitoringStorage } from '@geekmidas/telescope/storage/memory';
export { Studio } from './Studio';
// Types
export {
	type ColumnInfo,
	type ColumnType,
	type CursorConfig,
	type DataBrowserOptions,
	Direction,
	type FilterCondition,
	FilterOperator,
	type MonitoringOptions,
	type NormalizedStudioOptions,
	type QueryOptions,
	type QueryResult,
	type SchemaInfo,
	type SortConfig,
	type StudioEvent,
	type StudioEventType,
	type StudioOptions,
	type TableCursorConfig,
	type TableInfo,
} from './types';
