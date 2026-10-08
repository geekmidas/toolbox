import type { Telemetry } from '@geekmidas/constructs/telemetry';

/**
 * None by default: a test that wants telemetry has `writeComposeApp` write a
 * `Telemetry` construct here, which the API, the auth server, the worker and the site
 * are each given.
 */
export const telemetry: Telemetry | undefined = undefined;
