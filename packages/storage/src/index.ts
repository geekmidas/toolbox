export {
	MalformedStorageUrl,
	MissingStorageBucket,
	StorageUrlError,
	UnexpectedStorageScheme,
	UnregisteredStorageScheme,
} from './errors';
export type { StorageDriver } from './registry';
export {
	createStorageClient,
	registeredStorageSchemes,
	registerStorageDriver,
} from './registry';
export type { StorageClient } from './StorageClient.ts';
