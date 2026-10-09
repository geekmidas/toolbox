/**
 * `@geekmidas/cli/deploy`: deploy a project from a program rather than a
 * terminal.
 *
 * ```ts
 * import { deploy, MissingCredential } from '@geekmidas/cli/deploy';
 *
 * const run = deploy({
 *   cwd: '/srv/checkouts/shop',
 *   stage: 'production',
 *   credentials: {
 *     async get(request) {
 *       if (request.kind === 'dokploy') {
 *         return { endpoint: 'https://dokploy.example.com', token: vault.dokploy };
 *       }
 *     },
 *   },
 *   signal: AbortSignal.timeout(30 * 60_000),
 * });
 *
 * for await (const event of run) publish(event);
 * const result = await run.result;
 * ```
 *
 * Nothing in here prompts, prints or exits the process.
 *
 * The project's own code — its config, its constructs, each app's entry —
 * runs in a `Sandbox`: by default a `LocalSandbox`, a child process with an
 * allowlisted environment; for repositories the host does not trust, one of
 * the host's own that isolates (`sandbox: myContainerSandbox`).
 */

export { ConfigLoadFailed, ConfigObjectNotSerializable } from '../config';
export { GKM_HOME_ENV, gkmHome } from '../home';
export { UnknownStageProvider } from '../providers/config';
export { StageProviderDisabled } from '../providers/notes';
export { ProvisionedBucketUnreachable } from '../providers/s3/errors';
export {
	ConstructDiscoveryFailed,
	ConstructsNotSerializable,
} from '../reconcile/discover';
export {
	allowlistedEnv,
	CommandFailed,
	CommandTimedOut,
	confineCwd,
	INSTALL_TIMEOUT_MS,
	InstallAllowlistNameInvalid,
	type InstallOptions,
	InstallScriptsAllowlistUnsupported,
	installDependencies,
	LocalSandbox,
	type LocalSandboxOptions,
	SANDBOX_ENV_ALLOWLIST,
	type Sandbox,
	SandboxCwdEscape,
	type SandboxExecOptions,
	type SandboxOutput,
	type SandboxResult,
	SandboxWorkerFailed,
	SECRETS_DIR_ENV,
	SecretNameInvalid,
} from '../sandbox';
export {
	DeployTargetNotYetSupported,
	UnknownDeployTarget,
} from '../target/builtins';
export {
	DeploymentFailed,
	DeploymentTimedOut,
} from '../target/dokploy/dokploy-api';
export {
	BackendDeployFailed,
	FrontendDeployFailed,
	MissingEnvVars,
} from '../target/dokploy/engine';
export { HealthCheckTimedOut } from '../target/dokploy/health';
export { DeployMigrationsFailed } from '../target/dokploy/migrations';
export {
	NothingToRollBack,
	type RollbackInput,
	RollbackNeedsApp,
	type RolledBack,
	rollbackStage,
	StageNeverDeployed,
} from '../target/dokploy/rollback';
export { TargetPackageNotFound } from '../target/package';
export { ProviderRemoved } from '../target/provider';
export {
	InvalidTargetOptions,
	TargetEntryInvalid,
	TargetPackageInvalid,
	TargetRuntimeMismatch,
} from '../target/resolve';
export { TargetRuntimeUndeclared } from '../target/runtime';
export { DeploySeedsFailed } from '../target/seeds';
export {
	SstConfigNotFound,
	SstOutputsUnreadable,
	SurfacesUnhealthy,
} from '../target/sst/index';
export type { Actor, GithubActor, LocalActor } from './actor';
export {
	type AwsCredential,
	type Credential,
	type CredentialKind,
	type CredentialKinds,
	type CredentialProvider,
	type CredentialRequest,
	chainCredentials,
	MissingCredential,
	type StoredCredentialsOptions,
	storedCredentials,
} from './credentials';
export {
	type DeployInput,
	type DeployLogger,
	type DeployRun,
	deploy,
} from './deploy';
export {
	AllowDevServicesTakesNoValue,
	DEV_SERVICES,
	type DevService,
	DevServicesNeedServerTarget,
	ExternalServicesNotConfigured,
	type MissingServiceKey,
} from './devServices';
export type {
	DeployEvent,
	DeployEventError,
	DeployEventType,
	DeployPhase,
	ResourceChange,
	ResourceVia,
} from './events';
export { type DeployIdentity, deployIdentity } from './identity';
export {
	NoDeployableApps,
	RollbackFailed,
	TargetBuildsNothing,
	UnknownDeployApps,
} from './orchestrate';
export { ProjectNotOwned } from './ownership';
export {
	RegistryAmbiguous,
	RegistryNotConfigured,
	RegistryNotFound,
} from './registry';
export {
	LocalStateInCi,
	StateLocked,
	StateVersionConflict,
} from './StateStore';
export type { AppDeployResult, DeployResult } from './types';
