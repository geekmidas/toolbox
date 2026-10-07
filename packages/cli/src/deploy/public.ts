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
export { TargetPackageNotFound } from '../target/package';
export { ProviderRemoved } from '../target/provider';
export {
	InvalidTargetOptions,
	TargetEntryInvalid,
	TargetPackageInvalid,
	TargetRuntimeMismatch,
} from '../target/resolve';
export { TargetRuntimeUndeclared } from '../target/runtime';
export {
	SstConfigNotFound,
	SstOutputsUnreadable,
	SurfacesUnhealthy,
} from '../target/sst/index';
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
export type {
	DeployEvent,
	DeployEventError,
	DeployEventType,
	DeployPhase,
	ResourceChange,
	ResourceVia,
} from './events';
export { type DeployIdentity, deployIdentity } from './identity';
export { BackendDeployFailed, MissingEnvVars } from './index';
export {
	NoDeployableApps,
	RollbackFailed,
	UnknownDeployApps,
} from './orchestrate';
export { ProjectNotOwned } from './ownership';
export {
	RegistryAmbiguous,
	RegistryNotConfigured,
	RegistryNotFound,
} from './registry';
export { StateLocked, StateVersionConflict } from './StateStore';
export type { AppDeployResult, DeployResult } from './types';
