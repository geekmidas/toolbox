/**
 * `@geekmidas/cli/target`: write a deploy target.
 *
 * ```ts
 * // @acme/gkm-target — package.json: "gkm": { "runtime": "server" }
 * import { defineTarget } from '@geekmidas/cli/target';
 *
 * export default defineTarget({
 *   name: 'acme',
 *   runtime: 'server',
 *   capabilities: { rollback: false, migrations: 'app', images: true },
 *   async validate(ctx) { … },
 *   async plan(ctx, run) { … },
 *   async release(ctx, run) { … },
 *   result(ctx, run) { … },
 * });
 * ```
 *
 * ```ts
 * // gkm.config.ts
 * deploy: {
 *   default: 'acme',
 *   targets: { acme: ['@acme/gkm-target', { region: 'ams' }] },
 * }
 * ```
 *
 * Importing this loads no deploy engine: it is the interface, `defineTarget`
 * and the errors resolution raises.
 */

export type {
	AwsCredential,
	Credential,
	CredentialKind,
	CredentialKinds,
	CredentialProvider,
	CredentialRequest,
} from '../deploy/credentials';
export type {
	DeployEvent,
	DeployEventError,
	DeployEventType,
	DeployPhase,
	ResourceChange,
	ResourceVia,
} from '../deploy/events';
export type { DeployIdentity } from '../deploy/identity';
export type { StateStore } from '../deploy/StateStore';
export type { AppDeployResult, DeployResult } from '../deploy/types';
export type { StageSecrets } from '../secrets/types';
export {
	DeployTargetNotYetSupported,
	UnknownDeployTarget,
} from './builtins';
export { defineTarget, isDeployTarget } from './define';
export { TargetPackageNotFound } from './package';
export { ProviderRemoved } from './provider';
export {
	InvalidTargetOptions,
	TargetEntryInvalid,
	TargetPackageInvalid,
	TargetRuntimeMismatch,
} from './resolve';
export { TargetRuntimeUndeclared } from './runtime';
export type {
	AnyDeployTarget,
	DeployFailure,
	DeployPhaseContext,
	DeployRuntime,
	DeploySecrets,
	DeployTarget,
	DeployTargetCapabilities,
	DeployTargetEntry,
	DeployTargetLogger,
	TargetEvent,
	TargetOptions,
	TargetOptionsIssue,
	TargetOptionsSchema,
} from './types';
