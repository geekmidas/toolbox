// Re-export types

// Re-export context utilities
export {
	type RequestContextData,
	runWithRequestContext,
	serviceContext,
} from './context';
// Re-export ServiceDiscovery and utility types
export {
	type ExtractServiceNames,
	ServiceDiscovery,
	type ServiceRecord,
} from './ServiceDiscovery';
export type { Service, ServiceContext, ServiceRegisterOptions } from './types';
