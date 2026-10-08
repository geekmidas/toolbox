// Core construct types

// Re-export from services for convenience
export type { Service, ServiceRecord } from '@geekmidas/services';
export {
	Construct,
	ConstructType,
	snifferContext,
	sniffService,
} from './Construct';
// Telemetry interface
export type {
	Telemetry,
	TelemetryContext,
	TelemetryRequest,
	TelemetryResponse,
} from './endpoints/lambdaTelemetry';
export { onShutdown, runShutdownHooks } from './shutdown';
// Stage names, typed from the declared stages by `.gkm/stages.d.ts`
export type {
	AnyStage,
	DeployedStage,
	LocalStage,
	SeedContext,
	Stages,
	TestStage,
} from './stages';
// Types
export type {
	HttpMethod,
	LowerHttpMethod,
	RemoveUndefined,
} from './types';
