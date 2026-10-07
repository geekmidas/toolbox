export {
	IncompleteStorageCredentials,
	MalformedStorageUrl,
	MissingStorageBucket,
	redactStorageUrl,
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
