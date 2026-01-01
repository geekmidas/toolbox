// Core
export { Studio } from './Studio';

// Types
export {
  Direction,
  FilterOperator,
  type CursorConfig,
  type TableCursorConfig,
  type MonitoringOptions,
  type DataBrowserOptions,
  type StudioOptions,
  type NormalizedStudioOptions,
  type ColumnType,
  type ColumnInfo,
  type TableInfo,
  type SchemaInfo,
  type FilterCondition,
  type SortConfig,
  type QueryOptions,
  type QueryResult,
  type StudioEventType,
  type StudioEvent,
} from './types';

// Re-export Telescope storage types for convenience
// Users should import storage from @geekmidas/studio, not @geekmidas/telescope
export type { TelescopeStorage as MonitoringStorage } from '@geekmidas/telescope';

// Re-export InMemoryStorage as InMemoryMonitoringStorage
export { InMemoryStorage as InMemoryMonitoringStorage } from '@geekmidas/telescope/storage/memory';
