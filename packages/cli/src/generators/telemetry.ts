import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { TelemetryDeclaration } from '@geekmidas/manifest';

/**
 * One route's own telemetry — an endpoint's `.telemetry({ ignore, attributes })`.
 */
export interface TelemetryRoute {
	method: string;
	/** The route as the surface serves it — `/users/:id`. */
	path: string;
	ignore?: boolean;
	attributes?: Readonly<Record<string, string>>;
}

/** Each endpoint's own `.telemetry({ ignore, attributes })`, as routes. */
export function routeTelemetry(
	endpoints: readonly {
		method: string;
		route: string;
		telemetry?: Omit<TelemetryRoute, 'method' | 'path'>;
	}[],
): TelemetryRoute[] {
	return endpoints.flatMap((endpoint) =>
		endpoint.telemetry
			? [
					{
						method: endpoint.method,
						path: endpoint.route,
						...endpoint.telemetry,
					},
				]
			: [],
	);
}

/**
 * What an entry starts OpenTelemetry with, decided at build time from the
 * process's edge to a `Telemetry` node.
 *
 * Only built for a process with that edge — every other process gets the
 * stub, which loads nothing — and only once the packages it needs resolve:
 * a process that uses the node and cannot load them fails the build with
 * {@link TelemetryPackagesMissing}.
 */
export interface TelemetryContext {
	/** `service.name` — the surface or worker; `OTEL_SERVICE_NAME` overrides it. */
	serviceName: string;
	/** `service.namespace` — the workspace the app is part of. */
	serviceNamespace?: string;
	/** The node's `ignorePaths`. */
	ignorePaths: readonly string[];
	/** The node's `attributes`, on every span and log record. */
	attributes: Readonly<Record<string, string>>;
	/** Each route that says something of its own. */
	routes: readonly TelemetryRoute[];
}

/**
 * Every package `@geekmidas/telescope/instrumentation` loads at runtime.
 *
 * All of them, rather than one as a proxy: the production bundle follows each
 * import, and a single missing one fails the build rather than the telemetry.
 */
export const TELEMETRY_PACKAGES = [
	'@opentelemetry/api',
	'@opentelemetry/auto-instrumentations-node',
	'@opentelemetry/exporter-logs-otlp-http',
	'@opentelemetry/exporter-trace-otlp-http',
	'@opentelemetry/instrumentation-pino',
	'@opentelemetry/resources',
	'@opentelemetry/sdk-logs',
	'@opentelemetry/sdk-node',
	'@opentelemetry/sdk-trace-base',
	'@opentelemetry/sdk-trace-node',
	'@opentelemetry/semantic-conventions',
] as const;

/**
 * The directory of `name` as `node_modules` lookup finds it from `fromDir`,
 * symlinks resolved — or undefined.
 *
 * The directory walk alone, not `require.resolve`: that also searches
 * `NODE_PATH`, which a package manager's bin shim sets to its own store, so a
 * `gkm build` run through one would find packages the app never installed —
 * and the bundler, which does not look there, would then fail on them.
 */
function packageDir(fromDir: string, name: string): string | undefined {
	for (let dir = resolve(fromDir); ; dir = dirname(dir)) {
		const candidate = join(dir, 'node_modules', name);
		if (existsSync(join(candidate, 'package.json'))) {
			return realpathSync(candidate);
		}
		if (dirname(dir) === dir) return undefined;
	}
}

/**
 * The telemetry packages that do not resolve the way the bundler will resolve
 * them — telescope from the app, and the OpenTelemetry packages from
 * telescope, where a peer is linked under pnpm, which need not be where the
 * app sees it. Empty when every one does.
 */
export function missingTelemetryPackages(appRoot: string): string[] {
	const telescope = packageDir(appRoot, '@geekmidas/telescope');
	if (!telescope) return ['@geekmidas/telescope', ...TELEMETRY_PACKAGES];

	return TELEMETRY_PACKAGES.filter((pkg) => !packageDir(telescope, pkg));
}

/**
 * An app uses a `Telemetry` construct and cannot load what it needs to.
 *
 * Failed at build, not at startup: a process that was given telemetry and
 * quietly ran without it is an outage nobody can see into.
 */
export class TelemetryPackagesMissing extends Error {
	readonly command: string;

	constructor(
		readonly app: string,
		readonly missing: readonly string[],
		/** The app's directory, relative to where the command is run. */
		readonly dir: string,
	) {
		const command = `pnpm --dir ${dir || '.'} add ${missing.join(' ')}`;
		super(
			`'${app}' uses a Telemetry construct, and ${missing.join(', ')} ` +
				`${missing.length === 1 ? 'does' : 'do'} not resolve from it — its ` +
				'server would start without exporting a span. Add them to the app ' +
				`and build again:\n\n  ${command}\n`,
		);
		this.name = 'TelemetryPackagesMissing';
		this.command = command;
	}
}

/**
 * The telemetry half of a build context: undefined for a process with no
 * edge to a `Telemetry` node, and — for one with an edge — what its entry
 * starts with, once every package it needs resolves.
 */
export function telemetryFor(options: {
	/** The node the process emits through — see `telemetryOf`. */
	node: TelemetryDeclaration | undefined;
	appRoot: string;
	/** The app's name, for the error. */
	app: string;
	/** Where `pnpm` is run from, for the error's command. */
	cwd?: string;
	serviceName: string;
	workspaceName?: string;
	routes?: readonly TelemetryRoute[];
}): TelemetryContext | undefined {
	const { node } = options;
	if (!node) return undefined;

	const missing = missingTelemetryPackages(options.appRoot);
	if (missing.length > 0) {
		throw new TelemetryPackagesMissing(
			options.app,
			missing,
			relative(options.cwd ?? process.cwd(), options.appRoot),
		);
	}

	return {
		serviceName: options.serviceName,
		...(options.workspaceName && { serviceNamespace: options.workspaceName }),
		ignorePaths: [...(node.ignorePaths ?? [])],
		attributes: { ...node.attributes },
		routes: [...(options.routes ?? [])],
	};
}

const HEADER = `/**
 * Generated by gkm, for the production entry and the \`gkm dev\` one alike.
 *
 * Starts OpenTelemetry when OTEL_EXPORTER_OTLP_ENDPOINT names a collector, and
 * does nothing otherwise: without it, the telemetry packages are not loaded.
 * The standard OTEL_* variables (OTEL_TRACES_SAMPLER, OTEL_TRACES_SAMPLER_ARG,
 * OTEL_EXPORTER_OTLP_HEADERS, OTEL_RESOURCE_ATTRIBUTES, OTEL_SERVICE_NAME)
 * configure the rest.
 */

import type { MiddlewareHandler } from 'hono';

export interface StartTelemetryOptions {
  /** Requests whose spans would only be noise: health checks, by default. */
  ignorePaths?: string[];
  /**
   * The API's own sites — the origins its CORS allows — read on each request.
   * Their \`traceparent\` is continued, as is an internal caller's; anyone
   * else's starts a new trace linked to the one it claimed.
   */
  trustedOrigins?: () => readonly string[];
}
`;

/** `/users/:id` as a pattern over a request's path. */
function routePattern(path: string): string {
	const body = path
		.split('/')
		.map((segment) => {
			if (segment.startsWith(':')) return '[^/]+';
			if (segment === '*') return '.*';
			return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		})
		.join('/');
	return `^${body}/?$`;
}

/**
 * The entry's `telemetry.ts`: a `startTelemetry()` the server awaits before it
 * imports the app, so the libraries the app loads are instrumented. It returns
 * the Hono middleware that traces each request, or undefined when telemetry is
 * off — the server mounts it ahead of every route.
 *
 * Without a context — a process with no edge to a `Telemetry` node — it is a
 * stub that loads nothing and says nothing: telemetry is not something that
 * process was given.
 *
 * Failing to start telemetry warns (a named `TelemetryUnavailable`, through
 * `process.emitWarning`) and never stops the server: an outage in observability
 * is not a reason to have an outage in the service.
 */
export function generateTelemetryModule(
	telemetry: TelemetryContext | undefined,
): string {
	if (!telemetry) {
		return `${HEADER}
// This process has no Telemetry construct, so there is nothing to start.
export async function startTelemetry(
  _options: StartTelemetryOptions = {},
): Promise<MiddlewareHandler | undefined> {
  return undefined;
}
`;
	}

	const options = [
		`serviceName: ${JSON.stringify(telemetry.serviceName)},`,
		...(telemetry.serviceNamespace
			? [`serviceNamespace: ${JSON.stringify(telemetry.serviceNamespace)},`]
			: []),
		// The stage the deploy set, so one service's stages stay apart.
		'deploymentEnvironment: process.env.STAGE,',
		...(Object.keys(telemetry.attributes).length
			? [`resourceAttributes: ${JSON.stringify(telemetry.attributes)},`]
			: []),
		// The exporters read OTEL_EXPORTER_OTLP_* themselves, and the SDK reads
		// OTEL_TRACES_SAMPLER — so no endpoint and no ratio are printed here.
		// The server's own shutdown decides when the process exits.
		'handleSignals: false,',
		// Neither is left to module-load hooks, which see nothing inside a
		// bundle: @geekmidas/logger emits each record through the logs API
		// itself, and the middleware returned below opens each request's span.
		// Hooked as well where they can be, every record and request would be
		// sent twice.
		'instrumentPino: false,',
		'incomingHttpSpans: false,',
	];

	const routes = telemetry.routes.map((route) => ({
		method: route.method.toUpperCase(),
		pattern: routePattern(route.path),
		...(route.ignore ? { ignore: true } : {}),
		...(route.attributes && Object.keys(route.attributes).length
			? { attributes: route.attributes }
			: {}),
	}));
	const withAttributes = routes.some((route) => 'attributes' in route);

	return `${HEADER}
/** Telemetry was asked for and cannot start. The server runs without it. */
export class TelemetryUnavailable extends Error {
  constructor(readonly reason: string, options?: { cause?: unknown }) {
    super(
      \`OTEL_EXPORTER_OTLP_ENDPOINT is set, but \${reason} This server exports no traces or logs until that is fixed.\`,
      options,
    );
    this.name = 'TelemetryUnavailable';
  }
}

/** The Telemetry construct's own ignored paths, beside the entry's. */
const IGNORE_PATHS: string[] = ${JSON.stringify(telemetry.ignorePaths)};

/** Each route's own .telemetry({ ignore, attributes }). */
const ROUTES: {
  method: string;
  pattern: string;
  ignore?: boolean;
  attributes?: Record<string, string>;
}[] = ${JSON.stringify(routes)};

const MATCHERS = ROUTES.map((route) => ({ ...route, regex: new RegExp(route.pattern) }));

function routeOf(method: string, path: string) {
  return MATCHERS.find(
    (route) => (route.method === method || route.method === 'ALL' || route.method === 'ANY') && route.regex.test(path),
  );
}

export async function startTelemetry(
  options: StartTelemetryOptions = {},
): Promise<MiddlewareHandler | undefined> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;

  let instrumentation;
  try {
    instrumentation = await import('@geekmidas/telescope/instrumentation');
  } catch (cause) {
    process.emitWarning(
      new TelemetryUnavailable(
        '@geekmidas/telescope/instrumentation or an @opentelemetry package it needs could not be loaded. Install them in the app and rebuild.',
        { cause },
      ),
    );
    return undefined;
  }

  instrumentation.setupTelemetry({
    ${options.join('\n    ')}
  });

  // Flush what is buffered when the process is told to stop. When nothing
  // else handles the signal, re-raise it once flushed, so the process still
  // stops the way it would have without this listener.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void instrumentation.flushTelemetry().finally(() => {
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    });
  }

  // A SERVER span per request, opened by the app itself rather than by
  // hooking node:http: \`GET /users/:id\`, continuing an incoming traceparent
  // from the API's own sites and internal callers (a new, linked trace from
  // anyone else), with the handler — its logs, fetches and queries — running
  // inside it.
  const spans = instrumentation.honoTelemetryMiddleware({
    ignorePaths: [...(options.ignorePaths ?? []), ...IGNORE_PATHS],
    trustedOrigins: options.trustedOrigins,
    ...(MATCHERS.some((route) => route.ignore)
      ? { shouldSkip: (c) => routeOf(c.req.method, c.req.path)?.ignore === true }
      : {}),
  });
${
	withAttributes
		? `
  // A route's own attributes, on the span the middleware just opened.
  const { trace } = await import('@opentelemetry/api');
  return (c, next) =>
    spans(c, async () => {
      const attributes = routeOf(c.req.method, c.req.path)?.attributes;
      if (attributes) trace.getActiveSpan()?.setAttributes(attributes);
      await next();
    });
`
		: `  return spans;
`
}}
`;
}

/**
 * What an entry starts telemetry with, before it imports the app — shared by
 * the production server, a self-serving surface's server and the `gkm dev`
 * entry, so the three cannot start it differently. Defines `requestSpans`.
 */
export function startTelemetryCode(ignorePaths: readonly string[]): string {
	return `// The API's own sites, known once the app has read its configuration: the
// origins its CORS allows are the ones whose trace context is continued.
let trustedOrigins: readonly string[] = [];

// Before the app is imported, so the libraries it loads are instrumented.
const { startTelemetry } = await import('./telemetry.js');
const requestSpans = await startTelemetry({
  ignorePaths: ${JSON.stringify(ignorePaths)},
  trustedOrigins: () => trustedOrigins,
});
`;
}

/** Mounts `requestSpans` on `app` ahead of every route. */
export function mountRequestSpansCode(app: string): string {
	return `// The span middleware goes on before any route, so every request runs in it.
if (requestSpans) ${app}.use('*', requestSpans);
`;
}

/** Writes the entry's `telemetry.ts` beside it. */
export async function writeTelemetryModule(
	outputDir: string,
	telemetry: TelemetryContext | undefined,
): Promise<void> {
	await mkdir(outputDir, { recursive: true });
	await writeFile(
		join(outputDir, 'telemetry.ts'),
		generateTelemetryModule(telemetry),
	);
}
