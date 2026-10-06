/**
 * How a tool finds what `gkm dev` is running on this machine.
 *
 * Every app already serves its data as JSON — Telescope's requests, logs and
 * exceptions, the declared database at `/__gkm/db`, the OpenAPI document — but
 * each on its own port, and nothing said which ports those were. A console had
 * to be told. So `gkm dev` serves one more thing, on one well-known loopback
 * port: `GET /__gkm` lists the running workspaces, their apps and the data APIs
 * each app exposes, `GET /__gkm/events` streams the changes, and
 * `/__gkm/workspaces/<id>/apps/<app>/…` forwards to an app's data APIs, so a
 * client talks to one origin.
 *
 * **Many sessions, one endpoint.** A developer runs several `gkm dev`s at once
 * — a workspace's own, the one per app turbo starts under it, another
 * project's. Each writes what it runs to a registry directory shared by the
 * machine (`~/.gkm/dev/sessions/<id>.json`) and removes it when it stops. The
 * endpoint is served by whichever of them bound the port first, and it reads
 * the registry rather than being told — so nothing has to be handed over when
 * that process exits. Every other session keeps trying to bind the port, and
 * the first to manage it after the host is gone is the new host. A session that
 * died without cleaning up is recognised by its pid and pruned.
 *
 * **Security.** Any web page the developer visits can send requests to a
 * loopback port, so nothing here trusts being on loopback:
 * - it binds `127.0.0.1` only;
 * - the `Host` header must be `127.0.0.1` or `localhost` with this port, which
 *   defeats DNS rebinding (an attacker's hostname resolving to 127.0.0.1);
 * - a browser's `Origin` must be in a workspace's `dev.allowedOrigins`, empty
 *   by default; CORS replies only to those, and a workspace is only visible to
 *   the origins it listed;
 * - every request carries the session token (`Authorization: Bearer …` or
 *   `?token=…`, since `EventSource` cannot set headers), which `gkm dev` prints
 *   in a connect URL the way Jupyter does;
 * - it is read-only: `GET` and `HEAD`, and the forwarder reaches an app's data
 *   APIs and nothing else of it.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
	linkSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ConstructManifest } from '@geekmidas/manifest';
import type { DevConfig } from '../workspace/types.js';

/** Where the endpoint listens unless configured otherwise. */
export const DEFAULT_DISCOVERY_PORT = 4983;

/** Overrides `dev.discoveryPort` — `0` serves on a port of its own. */
export const DISCOVERY_PORT_ENV = 'GKM_DISCOVERY_PORT';

/** Overrides where the sessions register — `~/.gkm/dev` by default. */
export const DISCOVERY_REGISTRY_ENV = 'GKM_DEV_REGISTRY';

/**
 * Set by a workspace's `gkm dev` for the app sessions turbo starts under it:
 * the workspace has printed the connect URL, so they do not repeat it.
 */
export const DISCOVERY_QUIET_ENV = 'GKM_DISCOVERY_QUIET';

/** The route everything is served under. */
const BASE = '/__gkm';

// ---------------------------------------------------------------------------
// What a session registers
// ---------------------------------------------------------------------------

/** Where an app is in its life. `stopped` is a server that exited on its own. */
export type AppStatus = 'starting' | 'ready' | 'reloading' | 'stopped';

/** A JSON API an app serves about itself. */
export type DataApiKind = 'telescope' | 'database' | 'openapi';

export interface SessionDataApi {
	kind: DataApiKind;
	/** Where the app serves it, e.g. `/__gkm/db`. */
	path: string;
}

export interface SessionApp {
	name: string;
	type: 'backend' | 'web' | 'mobile';
	port: number;
	/** Its address behind the edge, when it has one. */
	publicUrl?: string;
	status: AppStatus;
	/** How many times it has been rebuilt and restarted since it started. */
	reloads: number;
	dataApis: SessionDataApi[];
}

/**
 * One `gkm dev` process, as it registers itself.
 *
 * A `workspace` session is the workspace's own `gkm dev`: it lists every app
 * turbo starts, but runs none of them itself. An `app` session runs one app's
 * server, and knows its status and data APIs — so where both describe an app,
 * the `app` session's word is taken.
 */
export interface DevSessionRecord {
	id: string;
	pid: number;
	role: 'workspace' | 'app';
	startedAt: string;
	updatedAt: string;
	workspace: { name: string; root: string; stage: string };
	/** `dev.allowedOrigins`: the browser origins this workspace is shown to. */
	allowedOrigins: string[];
	manifest?: ConstructManifest;
	apps: SessionApp[];
}

// ---------------------------------------------------------------------------
// What `GET /__gkm` answers
// ---------------------------------------------------------------------------

export interface DiscoveredDataApi {
	kind: DataApiKind;
	/** Where the app serves it. */
	path: string;
	/** The app's own address for it — `http://localhost:<port><path>`. */
	url: string;
	/** The same API through this endpoint, relative to its origin. */
	proxy: string;
}

export interface DiscoveredApp {
	name: string;
	type: 'backend' | 'web' | 'mobile';
	port: number;
	/** `http://localhost:<port>`. */
	url: string;
	publicUrl: string | null;
	status: AppStatus;
	reloads: number;
	/** The `gkm dev` running it, when it runs in one of its own. */
	pid: number | null;
	dataApis: DiscoveredDataApi[];
}

export interface DiscoveredWorkspace {
	/** Stable for a workspace's root: its name, and a hash of where it is. */
	id: string;
	name: string;
	root: string;
	stage: string;
	manifest: ConstructManifest | null;
	apps: DiscoveredApp[];
}

/** The body of `GET /__gkm`. */
export interface DiscoveryResponse {
	version: 1;
	/** The `gkm dev` serving this endpoint, which may change while you watch. */
	host: { pid: number; port: number };
	/** Where the changes stream, as server-sent events. */
	events: string;
	workspaces: DiscoveredWorkspace[];
}

/** One message on `GET /__gkm/events`; its SSE `event:` is its `type`. */
export type DiscoveryEvent =
	| { type: 'snapshot'; snapshot: DiscoveryResponse }
	| { type: 'workspace.started' | 'workspace.stopped'; workspace: string }
	| {
			type: 'app.started' | 'app.stopped' | 'app.reloaded' | 'app.status';
			workspace: string;
			app: DiscoveredApp;
	  };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** `GKM_DISCOVERY_PORT` is set to something that is not a port. */
export class InvalidDiscoveryPort extends Error {
	constructor(readonly value: string) {
		super(
			`${DISCOVERY_PORT_ENV}=${value} is not a port. Set it to a number from 0 ` +
				'to 65535 (0 serves discovery on a free port of its own), or unset ' +
				'it to use dev.discoveryPort.',
		);
		this.name = 'InvalidDiscoveryPort';
	}
}

/** The port the endpoint uses: the env, then `dev.discoveryPort`, then 4983. */
export function discoveryPort(
	config: DevConfig | undefined,
	env: NodeJS.ProcessEnv = process.env,
): number {
	const raw = env[DISCOVERY_PORT_ENV];
	if (raw !== undefined && raw !== '') {
		const port = Number(raw);
		if (!Number.isInteger(port) || port < 0 || port > 65535) {
			throw new InvalidDiscoveryPort(raw);
		}
		return port;
	}
	return config?.discoveryPort ?? DEFAULT_DISCOVERY_PORT;
}

/** The machine's registry, shared by every `gkm dev`. */
export function discoveryRegistry(env: NodeJS.ProcessEnv = process.env) {
	return env[DISCOVERY_REGISTRY_ENV] || join(homedir(), '.gkm', 'dev');
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

function sessionsDir(registry: string): string {
	return join(registry, 'sessions');
}

/** Whether a process is alive. `EPERM` is someone else's — alive. */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/**
 * Every live session, pruning the ones whose process is gone — a `gkm dev`
 * killed outright never got to remove its own.
 */
export function liveSessions(registry: string): DevSessionRecord[] {
	const dir = sessionsDir(registry);
	let files: string[];
	try {
		files = readdirSync(dir).filter((file) => file.endsWith('.json'));
	} catch {
		return [];
	}

	const records: DevSessionRecord[] = [];
	for (const file of files) {
		const path = join(dir, file);
		let record: DevSessionRecord;
		try {
			record = JSON.parse(readFileSync(path, 'utf8'));
		} catch {
			// Removed between the listing and the read.
			continue;
		}
		if (alive(record.pid)) {
			records.push(record);
			continue;
		}
		try {
			unlinkSync(path);
		} catch {
			// Another session pruned it first.
		}
	}
	return records;
}

/** Written whole, then renamed into place, so a reader never sees half. */
function writeRecord(registry: string, record: DevSessionRecord): void {
	const path = join(sessionsDir(registry), `${record.id}.json`);
	const partial = `${path}.${process.pid}.tmp`;
	writeFileSync(partial, JSON.stringify(record), { mode: 0o600 });
	renameSync(partial, path);
}

function removeRecord(registry: string, id: string): void {
	try {
		unlinkSync(join(sessionsDir(registry), `${id}.json`));
	} catch {
		// Already gone.
	}
}

/**
 * The token every session prints and every host checks.
 *
 * Shared through the registry, so a URL printed by one session still works
 * after another has taken over hosting. It lives as long as some session does:
 * a session that finds none but itself starts a new one, so a token printed
 * yesterday stops working once everything it was printed by has stopped.
 */
function sessionToken(registry: string, self: string): string {
	const path = join(registry, 'token');
	const others = liveSessions(registry).filter((r) => r.id !== self);

	if (others.length === 0) {
		// Left by a session that died without removing it. Renamed away rather
		// than deleted, so only one of two sessions starting at once does it.
		const stale = `${path}.${self}.stale`;
		try {
			renameSync(path, stale);
			unlinkSync(stale);
		} catch {
			// None there, or another session got to it first.
		}
	}

	// Linked into place, which fails if one is already there — so two sessions
	// starting together agree on whichever landed first, and neither reads a
	// half-written file.
	const fresh = `${path}.${self}.new`;
	writeFileSync(fresh, randomBytes(32).toString('base64url'), {
		mode: 0o600,
	});
	try {
		linkSync(fresh, path);
	} catch {
		// Someone else's is already there; theirs is the token.
	}
	unlinkSync(fresh);
	return readFileSync(path, 'utf8').trim();
}

// ---------------------------------------------------------------------------
// The view: sessions merged into workspaces
// ---------------------------------------------------------------------------

/** A workspace as served, with who may see it. */
interface WorkspaceView extends DiscoveredWorkspace {
	allowedOrigins: readonly string[];
}

/** `<name>-<8 hex>`: readable, and two checkouts of a project stay apart. */
export function workspaceId(name: string, root: string): string {
	const slug =
		name
			.toLowerCase()
			.replace(/^@/, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'workspace';
	const hash = createHash('sha256').update(root).digest('hex').slice(0, 8);
	return `${slug}-${hash}`;
}

/** Whether anything accepts connections on a local port. */
function listening(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		// `localhost`, not 127.0.0.1: a Vite server listens on `::1` alone.
		const socket = connect({ port, host: 'localhost' });
		const done = (open: boolean) => {
			socket.destroy();
			resolve(open);
		};
		socket.setTimeout(300, () => done(false));
		socket.once('connect', () => done(true));
		socket.once('error', () => done(false));
	});
}

/** Which data APIs the forwarder matches by prefix, rather than exactly. */
const PREFIXED: ReadonlySet<DataApiKind> = new Set(['telescope', 'database']);

/** Whether `path` on an app is one of its data APIs. */
function servesData(app: DiscoveredApp, path: string): boolean {
	return app.dataApis.some((api) =>
		PREFIXED.has(api.kind)
			? path === api.path || path.startsWith(`${api.path}/`)
			: // The OpenAPI document is exactly `/__docs`; `/__docs/ui` is a page.
				path === api.path,
	);
}

/**
 * Every workspace the sessions describe, one entry per root.
 *
 * An app listed only by its workspace's session — a web app turbo started, an
 * API whose own `gkm dev` has not registered yet — is `ready` when its port
 * answers and `starting` until then.
 */
async function collect(records: DevSessionRecord[]): Promise<WorkspaceView[]> {
	const byRoot = new Map<string, DevSessionRecord[]>();
	for (const record of records) {
		const group = byRoot.get(record.workspace.root) ?? [];
		group.push(record);
		byRoot.set(record.workspace.root, group);
	}

	const views: WorkspaceView[] = [];
	for (const [root, group] of byRoot) {
		// The workspace's own session first, then the oldest: what names the
		// workspace and carries its manifest.
		group.sort(
			(a, b) =>
				Number(b.role === 'workspace') - Number(a.role === 'workspace') ||
				a.startedAt.localeCompare(b.startedAt),
		);
		const lead = group[0]!;
		const id = workspaceId(lead.workspace.name, root);

		const apps = new Map<string, { app: SessionApp; pid: number | null }>();
		for (const record of group) {
			for (const app of record.apps) {
				const own = record.role === 'app';
				if (!own && apps.has(app.name)) continue;
				apps.set(app.name, { app, pid: own ? record.pid : null });
			}
		}

		const discovered = await Promise.all(
			[...apps.values()].map(async ({ app, pid }): Promise<DiscoveredApp> => {
				const url = `http://localhost:${app.port}`;
				const status =
					pid === null
						? (await listening(app.port))
							? 'ready'
							: 'starting'
						: app.status;
				return {
					name: app.name,
					type: app.type,
					port: app.port,
					url,
					publicUrl: app.publicUrl ?? null,
					status,
					reloads: app.reloads,
					pid,
					dataApis: app.dataApis.map((api) => ({
						kind: api.kind,
						path: api.path,
						url: `${url}${api.path}`,
						proxy: `${BASE}/workspaces/${id}/apps/${encodeURIComponent(app.name)}${api.path}`,
					})),
				};
			}),
		);
		discovered.sort((a, b) => a.name.localeCompare(b.name));

		views.push({
			id,
			name: lead.workspace.name,
			root,
			stage: lead.workspace.stage,
			manifest: group.find((r) => r.manifest)?.manifest ?? null,
			apps: discovered,
			allowedOrigins: [...new Set(group.flatMap((r) => r.allowedOrigins))],
		});
	}

	return views.sort(
		(a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root),
	);
}

/** What changed between two views, as events. */
function changes(
	before: readonly WorkspaceView[],
	after: readonly WorkspaceView[],
): { workspace: WorkspaceView; event: DiscoveryEvent }[] {
	const out: { workspace: WorkspaceView; event: DiscoveryEvent }[] = [];
	const previous = new Map(before.map((w) => [w.id, w]));
	const next = new Map(after.map((w) => [w.id, w]));

	for (const workspace of after) {
		const was = previous.get(workspace.id);
		if (!was) {
			out.push({
				workspace,
				event: { type: 'workspace.started', workspace: workspace.id },
			});
		}
		const wasApps = new Map((was?.apps ?? []).map((a) => [a.name, a]));
		for (const app of workspace.apps) {
			const old = wasApps.get(app.name);
			const type = !old
				? 'app.started'
				: app.reloads > old.reloads
					? 'app.reloaded'
					: app.status !== old.status ||
							app.port !== old.port ||
							app.dataApis.length !== old.dataApis.length
						? 'app.status'
						: undefined;
			if (type) {
				out.push({
					workspace,
					event: { type, workspace: workspace.id, app },
				});
			}
		}
		for (const old of was?.apps ?? []) {
			if (!workspace.apps.some((a) => a.name === old.name)) {
				out.push({
					workspace,
					event: { type: 'app.stopped', workspace: workspace.id, app: old },
				});
			}
		}
	}

	for (const workspace of before) {
		if (next.has(workspace.id)) continue;
		for (const app of workspace.apps) {
			out.push({
				workspace,
				event: { type: 'app.stopped', workspace: workspace.id, app },
			});
		}
		out.push({
			workspace,
			event: { type: 'workspace.stopped', workspace: workspace.id },
		});
	}

	return out;
}

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

/** A browser with no `Origin` — curl, a local process — sees everything. */
function visibleTo(workspace: WorkspaceView, origin: string | undefined) {
	return origin === undefined || workspace.allowedOrigins.includes(origin);
}

function publicView({
	allowedOrigins: _,
	...workspace
}: WorkspaceView): DiscoveredWorkspace {
	return workspace;
}

/** Headers an app's response is passed on with; nothing that sets state. */
const FORWARDED_RESPONSE_HEADERS = [
	'content-type',
	'cache-control',
	'etag',
	'last-modified',
];

interface EventStream {
	origin: string | undefined;
	response: ServerResponse;
}

/**
 * The HTTP side: serves the registry it reads, checking every request.
 * @internal Exported for testing
 */
export class DiscoveryHost {
	private server: Server | undefined;
	private view: WorkspaceView[] = [];
	private streams = new Set<EventStream>();
	private scanning: Promise<WorkspaceView[]> | undefined;
	private timers: NodeJS.Timeout[] = [];
	private sequence = 0;

	constructor(
		private readonly registry: string,
		private readonly token: string,
		private readonly pollMs: number,
	) {}

	/** The port it is bound to, once it is. */
	get port(): number | undefined {
		const address = this.server?.address() as AddressInfo | null | undefined;
		return address?.port;
	}

	/** Binds the port; `false` when another process already has it. */
	async listen(port: number): Promise<boolean> {
		const server = createServer((request, response) => {
			this.handle(request, response).catch(() => {
				if (!response.headersSent) {
					reply(response, 500, { error: 'DiscoveryFailed' });
				} else {
					response.destroy();
				}
			});
		});
		const bound = await new Promise<boolean>((resolve) => {
			server.once('error', () => resolve(false));
			server.listen(port, '127.0.0.1', () => resolve(true));
		});
		if (!bound) return false;

		// Neither the server nor its timers hold `gkm dev` open; the dev server
		// and the watcher are what it runs for.
		server.unref();
		this.server = server;
		this.view = await this.scan();
		this.timers.push(
			setInterval(() => void this.scan(), this.pollMs).unref(),
			// A comment line every 15s, so proxies and idle timeouts leave the
			// stream open.
			setInterval(() => {
				for (const { response } of this.streams) response.write(': ping\n\n');
			}, 15_000).unref(),
		);
		return true;
	}

	async close(): Promise<void> {
		for (const timer of this.timers) clearInterval(timer);
		this.timers = [];
		for (const { response } of this.streams) response.end();
		this.streams.clear();
		const server = this.server;
		this.server = undefined;
		if (!server) return;
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
	}

	/** Reads the registry, and tells every stream what changed. One at a time. */
	scan(): Promise<WorkspaceView[]> {
		const run = (this.scanning ?? Promise.resolve()).then(async () => {
			const next = await collect(liveSessions(this.registry));
			for (const { workspace, event } of changes(this.view, next)) {
				this.broadcast(workspace, event);
			}
			this.view = next;
			return next;
		});
		this.scanning = run.catch(() => this.view);
		return run;
	}

	private broadcast(workspace: WorkspaceView, event: DiscoveryEvent): void {
		this.sequence += 1;
		for (const stream of this.streams) {
			if (!visibleTo(workspace, stream.origin)) continue;
			send(stream.response, event, this.sequence);
		}
	}

	private snapshot(origin: string | undefined): DiscoveryResponse {
		return {
			version: 1,
			host: { pid: process.pid, port: this.port ?? 0 },
			events: `${BASE}/events`,
			workspaces: this.view.filter((w) => visibleTo(w, origin)).map(publicView),
		};
	}

	private async handle(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		// Rebinding: a page on `evil.example` that resolves to 127.0.0.1 sends
		// `Host: evil.example`. Only our own names, with our own port.
		const port = this.port;
		const host = request.headers.host;
		if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
			reply(response, 403, {
				error: 'HostNotAllowed',
				message: `Reach discovery at http://127.0.0.1:${port}.`,
			});
			return;
		}

		const origin = request.headers.origin;
		const allowed = this.view.flatMap((w) => w.allowedOrigins);
		if (origin !== undefined && !allowed.includes(origin)) {
			// No CORS headers: the browser hides even this answer from the page.
			reply(response, 403, {
				error: 'OriginNotAllowed',
				message: `Add ${origin} to dev.allowedOrigins in gkm.config.ts to let it read gkm dev.`,
			});
			return;
		}
		if (origin !== undefined) {
			response.setHeader('access-control-allow-origin', origin);
			response.setHeader('vary', 'Origin');
		}

		if (request.method === 'OPTIONS') {
			// A preflight carries no credentials, so it is answered before the
			// token is asked for — only for an origin that was listed.
			response.setHeader('access-control-allow-methods', 'GET, HEAD');
			response.setHeader('access-control-allow-headers', 'Authorization');
			response.setHeader('access-control-max-age', '600');
			if (request.headers['access-control-request-private-network']) {
				response.setHeader('access-control-allow-private-network', 'true');
			}
			response.writeHead(204).end();
			return;
		}

		const url = new URL(request.url ?? '/', `http://${host}`);
		if (!this.authorized(request, url)) {
			reply(response, 401, {
				error: 'TokenRequired',
				message:
					'Use the connect URL gkm dev printed, or send its token as `Authorization: Bearer <token>`.',
			});
			return;
		}

		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.setHeader('allow', 'GET, HEAD, OPTIONS');
			reply(response, 405, {
				error: 'ReadOnly',
				message: 'Discovery is read-only: GET and HEAD.',
			});
			return;
		}

		const path = url.pathname.replace(/\/+$/, '') || '/';
		if (path === BASE) {
			await this.scan();
			reply(response, 200, this.snapshot(origin));
			return;
		}
		if (path === `${BASE}/events`) {
			await this.scan();
			this.stream(response, origin);
			response.once('close', () => {
				for (const stream of this.streams) {
					if (stream.response === response) this.streams.delete(stream);
				}
			});
			return;
		}

		const forwarded = path.match(
			/^\/__gkm\/workspaces\/([^/]+)\/apps\/([^/]+)(\/.*)$/,
		);
		if (forwarded) {
			const [, id, name, rest] = forwarded;
			await this.forward(
				request,
				response,
				origin,
				id!,
				decodeURIComponent(name!),
				rest!,
				url,
			);
			return;
		}

		reply(response, 404, { error: 'NotFound' });
	}

	private authorized(request: IncomingMessage, url: URL): boolean {
		const header = request.headers.authorization;
		const given = header?.startsWith('Bearer ')
			? header.slice('Bearer '.length).trim()
			: url.searchParams.get('token');
		if (!given) return false;
		const a = Buffer.from(given);
		const b = Buffer.from(this.token);
		return a.length === b.length && timingSafeEqual(a, b);
	}

	private stream(response: ServerResponse, origin: string | undefined): void {
		response.writeHead(200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
		});
		// When the host changes, `EventSource` reconnects — to the new one.
		response.write('retry: 1000\n\n');
		send(response, { type: 'snapshot', snapshot: this.snapshot(origin) });
		this.streams.add({ origin, response });
	}

	/** Passes a read of one data API on to the app that serves it. */
	private async forward(
		request: IncomingMessage,
		response: ServerResponse,
		origin: string | undefined,
		id: string,
		name: string,
		path: string,
		url: URL,
	): Promise<void> {
		const workspace = this.view.find(
			(w) => w.id === id && visibleTo(w, origin),
		);
		const app = workspace?.apps.find((a) => a.name === name);
		if (!app) {
			reply(response, 404, { error: 'AppNotFound' });
			return;
		}
		if (!servesData(app, path)) {
			reply(response, 404, {
				error: 'NotADataApi',
				message: `Only ${name}'s data APIs are forwarded: ${app.dataApis.map((a) => a.path).join(', ') || 'it has none'}.`,
			});
			return;
		}

		// The token is ours, not the app's.
		const search = new URLSearchParams(url.searchParams);
		search.delete('token');
		const query = search.size > 0 ? `?${search}` : '';

		// The response, not the request: a request's `close` fires once its
		// (empty) body is read, which would abort the read straight away.
		const abort = new AbortController();
		response.once('close', () => abort.abort());
		let upstream: Response;
		try {
			upstream = await fetch(`http://localhost:${app.port}${path}${query}`, {
				method: request.method,
				// Only what describes the read: no cookies, no credentials.
				headers: { accept: request.headers.accept ?? '*/*' },
				signal: abort.signal,
			});
		} catch {
			reply(response, 502, {
				error: 'AppUnavailable',
				message: `${name} is not answering on port ${app.port}.`,
			});
			return;
		}

		const headers: Record<string, string> = {};
		for (const key of FORWARDED_RESPONSE_HEADERS) {
			const value = upstream.headers.get(key);
			if (value) headers[key] = value;
		}
		response.writeHead(upstream.status, headers);
		if (!upstream.body || request.method === 'HEAD') {
			response.end();
			return;
		}
		Readable.fromWeb(upstream.body as never)
			.on('error', () => response.destroy())
			.pipe(response);
	}
}

function reply(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { 'content-type': 'application/json' });
	response.end(JSON.stringify(body));
}

function send(response: ServerResponse, event: DiscoveryEvent, id?: number) {
	response.write(
		`${id === undefined ? '' : `id: ${id}\n`}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
	);
}

// ---------------------------------------------------------------------------
// A session
// ---------------------------------------------------------------------------

export interface JoinDiscoveryOptions {
	role: DevSessionRecord['role'];
	workspace: DevSessionRecord['workspace'];
	allowedOrigins?: readonly string[];
	manifest?: ConstructManifest;
	apps: SessionApp[];
	/** `0` hosts on a free port of its own, and never hands over. */
	port?: number;
	registry?: string;
	/** How often the host rereads the registry. */
	pollMs?: number;
	/** How often a session that is not hosting tries to take over. */
	electionMs?: number;
}

/**
 * One `gkm dev`'s membership: its record in the registry, and — while it holds
 * the port — the endpoint itself.
 */
export class DiscoverySession {
	private host: DiscoveryHost | undefined;
	private election: NodeJS.Timeout | undefined;
	private left = false;
	private readonly cleanup = () => removeRecord(this.registry, this.record.id);

	private constructor(
		private readonly registry: string,
		private readonly port: number,
		private readonly record: DevSessionRecord,
		readonly token: string,
		private readonly pollMs: number,
	) {}

	static async join(options: JoinDiscoveryOptions): Promise<DiscoverySession> {
		const registry = options.registry ?? discoveryRegistry();
		mkdirSync(sessionsDir(registry), { recursive: true, mode: 0o700 });

		const now = new Date().toISOString();
		const record: DevSessionRecord = {
			id: `${process.pid}-${randomBytes(4).toString('hex')}`,
			pid: process.pid,
			role: options.role,
			startedAt: now,
			updatedAt: now,
			workspace: options.workspace,
			allowedOrigins: [...(options.allowedOrigins ?? [])],
			...(options.manifest ? { manifest: options.manifest } : {}),
			apps: options.apps,
		};
		// Registered before the token is settled, so a session starting at the
		// same moment sees this one and does not replace the token under it.
		writeRecord(registry, record);
		const token = sessionToken(registry, record.id);

		const session = new DiscoverySession(
			registry,
			options.port ?? DEFAULT_DISCOVERY_PORT,
			record,
			token,
			options.pollMs ?? 500,
		);
		process.once('exit', session.cleanup);

		await session.elect();
		// On port 0 every session hosts its own, so there is nothing to take
		// over.
		if (!session.host && session.port !== 0) {
			session.election = setInterval(
				() => void session.elect(),
				options.electionMs ?? 1000,
			).unref();
		}
		return session;
	}

	/** Whether this session is the one serving the endpoint. */
	get hosting(): boolean {
		return this.host !== undefined;
	}

	/** The port clients reach — this host's own, when it chose one. */
	get endpointPort(): number {
		return this.host?.port ?? this.port;
	}

	/** Jupyter-style: the endpoint, with the token that opens it. */
	get connectUrl(): string {
		return `http://127.0.0.1:${this.endpointPort}${BASE}?token=${this.token}`;
	}

	/** Changes one of this session's apps, and tells the endpoint. */
	updateApp(name: string, change: (app: SessionApp) => SessionApp): void {
		if (this.left) return;
		this.record.apps = this.record.apps.map((app) =>
			app.name === name ? change(app) : app,
		);
		this.record.updatedAt = new Date().toISOString();
		writeRecord(this.registry, this.record);
		// The host hears of its own changes now, not on its next poll.
		void this.host?.scan();
	}

	/** Leaves the registry, and the port to whichever session takes it next. */
	async leave(): Promise<void> {
		if (this.left) return;
		this.left = true;
		if (this.election) clearInterval(this.election);
		process.removeListener('exit', this.cleanup);
		this.cleanup();
		await this.host?.close();
		this.host = undefined;
		// The last one out takes the token with it.
		if (liveSessions(this.registry).length === 0) {
			try {
				unlinkSync(join(this.registry, 'token'));
			} catch {
				// Already gone.
			}
		}
	}

	private async elect(): Promise<void> {
		if (this.host || this.left) return;
		const host = new DiscoveryHost(this.registry, this.token, this.pollMs);
		if (!(await host.listen(this.port))) return;
		if (this.left) {
			await host.close();
			return;
		}
		this.host = host;
		if (this.election) clearInterval(this.election);
		this.election = undefined;
	}
}

/** Joins the machine's discovery; see {@link DiscoverySession}. */
export function joinDiscovery(
	options: JoinDiscoveryOptions,
): Promise<DiscoverySession> {
	return DiscoverySession.join(options);
}

/** The data APIs a generated dev app mounts, from what `gkm dev` built. */
export function dataApisOf(options: {
	selfServing: boolean;
	telescopePath?: string;
	databaseApi?: string;
	openApi: boolean;
}): SessionDataApi[] {
	// An app that serves itself — an auth server — mounts none of them.
	if (options.selfServing) return [];
	return [
		...(options.telescopePath
			? [{ kind: 'telescope' as const, path: `${options.telescopePath}/api` }]
			: []),
		...(options.databaseApi
			? [{ kind: 'database' as const, path: options.databaseApi }]
			: []),
		...(options.openApi ? [{ kind: 'openapi' as const, path: '/__docs' }] : []),
	];
}
