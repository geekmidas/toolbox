/**
 * Port allocation — why two projects can run at once.
 *
 * Publishing `5432:5432` means the second project on your machine cannot start.
 * Nothing solves that except giving each project its own ports, and what makes
 * it *possible* is the single-`<NAME>_URL` rule: an app reads `ORDERS_URL` and
 * never sees a host or a port, so reconcile is free to bind whatever is
 * available and compose the URL from what it bound. An app reading `DB_HOST` and
 * `DB_PORT` separately could not be moved this way.
 *
 * Assignments are **persisted, not recomputed**. Recomputing means adding a
 * construct renumbers its neighbours, and every running container, saved
 * connection string, and `psql` history goes stale at once.
 *
 * Pure, with the liveness probe injected — a collision with another project's
 * stack is a fact about the machine, and keeping it a parameter is what lets the
 * rules be asserted without binding a socket.
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

/** What was assigned, by container name. Persisted between runs. */
export type PortAssignments = Readonly<Record<string, number>>;

/**
 * The window ports are drawn from.
 *
 * Above the registered range so nothing here needs privileges, and below the
 * ephemeral range both Linux (32768+) and macOS (49152+) allocate from — a port
 * the kernel might hand to an outgoing connection is one that is free when
 * checked and taken by the time it is bound.
 */
const WINDOW = { min: 20000, max: 32000 } as const;

/**
 * How far apart two projects start.
 *
 * Wide enough that a project can add containers without walking into its
 * neighbour's block, narrow enough that the window holds many projects.
 */
const BLOCK = 50;

/**
 * Where a project's ports start.
 *
 * Derived from the name rather than assigned sequentially so that a fresh clone
 * of the same project on the same machine lands on the same block — the first
 * run has nothing persisted to read, and hashing is what keeps that first run
 * from colliding with whatever else is already allocated.
 *
 * @example startingPort('toolbox') // stable for a given name
 */
export function startingPort(project: string): number {
	const digest = createHash('sha256').update(project).digest();
	const blocks = Math.floor((WINDOW.max - WINDOW.min) / BLOCK);

	return WINDOW.min + (digest.readUInt32BE(0) % blocks) * BLOCK;
}

/**
 * Whether a port can be bound right now.
 *
 * Async because the only way to answer it is to try binding, and
 * `server.listen` is asynchronous — there is no synchronous form to wrap. A
 * probe that pretended otherwise would have to lie.
 */
export type PortProbe = (port: number) => Promise<boolean>;

/**
 * Assign a port to every container that has none, keeping the ones that do.
 *
 * Existing assignments are returned untouched even when the container is no
 * longer in the plan: removing a construct must not renumber what is left, and
 * keeping the entry means re-adding it later restores the same port rather than
 * inventing a new one.
 *
 * @param probe - reports what is actually listening. A port assigned to this
 * project is skipped without probing, because on a converged reconcile our own
 * container is the thing listening on it.
 * @throws {NoPortAvailable} when the window is exhausted.
 */
export async function allocate(
	project: string,
	containers: readonly string[],
	existing: PortAssignments = {},
	probe: PortProbe = isPortFree,
): Promise<PortAssignments> {
	const assignments: Record<string, number> = { ...existing };
	const taken = new Set(Object.values(assignments));

	// Sorted so the order containers happen to appear in the plan cannot change
	// which port each one gets.
	for (const container of [...containers].sort()) {
		if (assignments[container] !== undefined) continue;

		const port = await nextFree(startingPort(project), taken, probe);
		assignments[container] = port;
		taken.add(port);
	}

	return assignments;
}

/**
 * The ports to keep: what running containers are observed on, then what was
 * saved — minus any saved entry whose port something else already holds.
 *
 * Spreading one over the other let an observed port override its own key and
 * leave a *different* key still saved on the same number: two services on one
 * port, and whichever answered first won. Saved keys for containers the plan no
 * longer has — a backend switched and back — were the usual source. Observed
 * wins because it is what is actually bound; a dropped entry is simply
 * allocated again.
 */
export function keptPorts(
	saved: PortAssignments = {},
	observed: PortAssignments = {},
): PortAssignments {
	const kept: Record<string, number> = { ...observed };
	const taken = new Set(Object.values(observed));

	// Sorted, so which of two colliding saved entries survives is stable.
	for (const [key, port] of Object.entries(saved).sort(([a], [b]) =>
		a < b ? -1 : 1,
	)) {
		if (key in kept || taken.has(port)) continue;
		kept[key] = port;
		taken.add(port);
	}

	return kept;
}

/**
 * Whether a port is published by one of this project's own containers.
 *
 * Asked only of a port the probe found taken: our own container on it is the
 * normal re-run, anything else is a stack that took the port since it was
 * saved.
 */
export type PortOwner = (port: number) => Promise<boolean>;

/** A kept port something else now holds, and where its container moved. */
export interface PortMove {
	key: string;
	from: number;
	to: number;
}

/**
 * The kept ports, among those the plan publishes, that something other than
 * this project now holds.
 *
 * A saved port is only a memory of a free one. Another checkout's stack — the
 * same project name hashes to the same block — can bind it in the meantime,
 * and keeping it unchecked fails `docker compose up` with "port is already
 * allocated". An observed port is ours by definition and is never asked
 * about; neither is a saved one the plan no longer publishes, which is only
 * kept for when it returns.
 */
export async function heldElsewhere(
	kept: PortAssignments,
	keys: readonly string[],
	observed: PortAssignments,
	probe: PortProbe,
	ours: PortOwner,
): Promise<string[]> {
	const held: string[] = [];

	for (const key of [...keys].sort()) {
		const port = kept[key];
		if (port === undefined || key in observed) continue;
		if (await probe(port)) continue;
		if (await ours(port)) continue;
		held.push(key);
	}

	return held;
}

/** The window was exhausted. */
export class NoPortAvailable extends Error {
	/** Where the search started. */
	readonly from: number;
	/** The window searched, so the caller can report what was full. */
	readonly window: { min: number; max: number } = WINDOW;

	constructor(from: number) {
		super('No free port is available in the local port range');
		this.name = 'NoPortAvailable';
		this.from = from;
	}
}

/**
 * The first port at or after `from` that is neither ours nor in use.
 *
 * Wraps at the top of the window rather than stopping, so a project whose block
 * sits near the end is not the one that fails.
 */
async function nextFree(
	from: number,
	taken: ReadonlySet<number>,
	probe: PortProbe,
): Promise<number> {
	const span = WINDOW.max - WINDOW.min;

	for (let offset = 0; offset < span; offset++) {
		const port = WINDOW.min + ((from - WINDOW.min + offset) % span);
		if (taken.has(port)) continue;
		if (await probe(port)) return port;
	}

	throw new NoPortAvailable(from);
}

/**
 * Whether nothing is listening on a port.
 *
 * Binds rather than connects: a refused connection says nothing about whether
 * the port can be *published*, which is the question Docker will ask. Binds on
 * `0.0.0.0` for the same reason — a port free on loopback can still be taken on
 * the address Docker publishes to — and then on `127.0.0.1`, because on macOS
 * a wildcard bind succeeds beside a listener on loopback alone.
 *
 * Inherently racy, and that is acceptable: Docker failing to bind stays the real
 * check. This exists so the common case surfaces as a message at reconcile
 * rather than as a connection failure ten minutes later.
 */
export async function isPortFree(port: number): Promise<boolean> {
	return (await canBind(port, '0.0.0.0')) && (await canBind(port, '127.0.0.1'));
}

function canBind(port: number, host: string): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();

		server.once('error', () => resolve(false));
		server.once('listening', () => server.close(() => resolve(true)));
		server.listen(port, host);
	});
}
