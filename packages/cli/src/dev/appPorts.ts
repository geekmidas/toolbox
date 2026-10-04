/**
 * Which local port each app answers on — and what to do when it is taken.
 *
 * An app's port used to be fixed: 3000, 3001, … and `gkm dev` refused to start
 * if anything held one. That is right when the holder is this same app, left
 * running by a previous `gkm dev` — moving would start a second copy beside it.
 * It is wrong when the holder is another project's dev server, which also
 * defaults to 3000: two projects could not run at once, and nothing about the
 * app needs that port. A browser reaches it through the edge, whose URL carries
 * no app port, and every address a phone or a route uses is derived on each
 * start.
 *
 * So the holder is asked who it is. Every app process gkm starts is tagged with
 * {@link APP_TAG_ENV} — the workspace and the app — and children inherit it, so
 * whatever actually binds the port (`next-server`, a Metro worker, the tsx
 * server) carries it. A held port whose holder carries this app's tag is a
 * leftover, and is refused; anything else — untagged, another workspace's,
 * unreadable — is not ours, and the app moves to the next free port.
 *
 * The choice is kept in `.gkm/app-ports.json`, not recomputed: an app that
 * moved stays where it moved, so a bookmark or a phone's saved address does not
 * break the next time the other project happens to be stopped. Local only —
 * `gkm deploy` and `gkm docker` never read it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { NormalizedWorkspace } from '../workspace/types.js';

/** Carried by every app process gkm starts: `<workspace root>#<app>`. */
export const APP_TAG_ENV = 'GKM_DEV_APP';

const APP_PORTS_PATH = '.gkm/app-ports.json';

/** The tag an app's processes carry. The root is encoded, so it has no spaces. */
export function appTag(root: string, app: string): string {
	return `${encodeURIComponent(resolve(root))}#${app}`;
}

/** What listens on a port, and the tag it carries if it can be read. */
export interface PortHolder {
	pid: number;
	command?: string;
	tag?: string;
}

/** Says, as `command (pid N)`, what holds a port. */
export function describeHolder(holder: PortHolder | undefined): string {
	if (!holder) return 'another process';
	return `${holder.command ?? 'a process'} (pid ${holder.pid})`;
}

/**
 * Who is listening on a port, read the way a person would: `lsof` for the
 * pid, then that process's environment for its tag — `/proc/<pid>/environ` on
 * Linux, `ps eww` elsewhere. Both work for the user's own processes, which is
 * every process gkm starts; one that cannot be read has no tag, so is not ours.
 */
export function holderOf(port: number): PortHolder | undefined {
	let out: string;
	try {
		out = execFileSync(
			'lsof',
			['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		);
	} catch {
		return undefined;
	}

	const pid = Number(out.match(/^p(\d+)/m)?.[1]);
	if (!pid) return undefined;
	const command = out.match(/^c(.+)$/m)?.[1];
	const tag = tagOf(pid);

	return {
		pid,
		...(command ? { command } : {}),
		...(tag ? { tag } : {}),
	};
}

function tagOf(pid: number): string | undefined {
	const prefix = `${APP_TAG_ENV}=`;
	try {
		const entries =
			process.platform === 'linux'
				? readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
				: execFileSync('ps', ['eww', '-o', 'command=', '-p', String(pid)], {
						encoding: 'utf8',
						stdio: ['ignore', 'pipe', 'ignore'],
					}).split(/\s+/);
		return entries
			.find((entry) => entry.startsWith(prefix))
			?.slice(prefix.length);
	} catch {
		return undefined;
	}
}

/** The ports apps were given before, by app name. */
export async function savedAppPorts(
	root: string,
): Promise<Record<string, number>> {
	try {
		return JSON.parse(await readFile(join(root, APP_PORTS_PATH), 'utf8'));
	} catch {
		return {};
	}
}

async function saveAppPorts(
	root: string,
	ports: Record<string, number>,
): Promise<void> {
	await mkdir(join(root, '.gkm'), { recursive: true });
	await writeFile(
		join(root, APP_PORTS_PATH),
		`${JSON.stringify(ports, null, 2)}\n`,
	);
}

/** The workspace, with each app on the port it was given locally. */
export function withAppPorts(
	workspace: NormalizedWorkspace,
	ports: Readonly<Record<string, number>>,
): NormalizedWorkspace {
	const apps = Object.fromEntries(
		Object.entries(workspace.apps).map(([name, app]) => [
			name,
			ports[name] ? { ...app, port: ports[name] } : app,
		]),
	);
	return { ...workspace, apps };
}

/** An app this workspace already has running — left by a previous start. */
export interface AppRunning {
	app: string;
	port: number;
	holder: PortHolder;
}

/** An app that moved, because another project holds its port. */
export interface AppMoved {
	app: string;
	from: number;
	to: number;
	holder: PortHolder | undefined;
}

export interface AppPortsDeps {
	/** Whether a port can be bound right now. */
	free: (port: number) => Promise<boolean>;
	/** Who holds a port. */
	holder: (port: number) => PortHolder | undefined;
}

/**
 * Give each named app a local port: the one it had, or its usual one, unless
 * another project holds it — then the next free one, which is kept.
 *
 * @returns every app's port, the apps that moved, and the apps this workspace
 *   already has running (the caller refuses to start those).
 */
export async function assignAppPorts(
	workspace: NormalizedWorkspace,
	names: readonly string[],
	deps: AppPortsDeps,
): Promise<{
	ports: Record<string, number>;
	moved: AppMoved[];
	running: AppRunning[];
}> {
	const saved = await savedAppPorts(workspace.root);
	const wanted: Record<string, number> = {};
	for (const name of names) {
		const port = saved[name] ?? workspace.apps[name]?.port;
		if (port) wanted[name] = port;
	}

	// Every app's wanted port is reserved before any moves, so one that moves
	// never lands on a sibling's.
	const taken = new Set([...Object.values(saved), ...Object.values(wanted)]);
	const ports: Record<string, number> = { ...saved };
	const moved: AppMoved[] = [];
	const running: AppRunning[] = [];

	// Sorted, so which app moves first — and where — does not depend on order.
	for (const name of Object.keys(wanted).sort()) {
		const want = wanted[name]!;
		ports[name] = want;
		if (await deps.free(want)) continue;

		const holder = deps.holder(want);
		if (holder?.tag === appTag(workspace.root, name)) {
			running.push({ app: name, port: want, holder });
			continue;
		}

		let next = want + 1;
		while (taken.has(next) || !(await deps.free(next))) next += 1;
		taken.add(next);
		ports[name] = next;
		moved.push({ app: name, from: want, to: next, holder });
	}

	await saveAppPorts(workspace.root, ports);
	return { ports, moved, running };
}
