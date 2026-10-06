/**
 * Which Dokploy project a deploy is allowed to deploy into.
 *
 * Deploy used to take any project whose name matched the workspace's, in any
 * case — so a second workspace called `shop` (or `Shop`) on the same server
 * deployed into the first one's project, over its images and applications. A
 * project is now claimed by an ownership marker in its description, and a
 * project with the right name and no marker is somebody else's.
 */

import {
	type DokployApi,
	DokployApiError,
	type DokployEnvironment,
	type DokployProjectDetails,
} from './dokploy-api';
import {
	type DeployIdentity,
	isOwnedBy,
	markerOf,
	ownershipMarker,
	projectName,
} from './identity';

/**
 * A Dokploy project with the name this deploy would use exists, and nothing
 * says this workspace created it.
 */
export class ProjectNotOwned extends Error {
	constructor(
		readonly projectName: string,
		readonly projectId: string,
		readonly identity: string,
		/** The marker the project carries instead, if it carries one. */
		readonly ownedBy: string | undefined,
	) {
		super(
			`The Dokploy project '${projectName}' (${projectId}) was not created by this workspace (${identity})${ownedBy ? ` — it is marked '${ownedBy}'` : ''}, so deploy will not use it. ` +
				`Set deploy.namespace in gkm.config.ts to deploy under a name of your own, or, if this project really is this workspace's, add 'gkm:${identity}' to its description in Dokploy.`,
		);
		this.name = 'ProjectNotOwned';
	}
}

export interface ResolvedProject {
	projectId: string;
	name: string;
	environments: DokployEnvironment[];
	/** How it was found, for the log. */
	via: 'state' | 'marker' | 'created';
}

/** A description with the marker added, keeping what was there. */
function withMarker(description: string | null, marker: string): string {
	const existing = (description ?? '').trim();
	return existing ? `${existing}\n${marker}` : marker;
}

/** `project.one`, or `null` when Dokploy no longer has the project. */
async function projectById(
	api: DokployApi,
	projectId: string,
): Promise<DokployProjectDetails | null> {
	try {
		// Dokploy answers an unknown id with an error on some versions and an
		// empty body on others.
		return (await api.getProject(projectId)) ?? null;
	} catch (error) {
		if (error instanceof DokployApiError) return null;
		throw error;
	}
}

/**
 * The project this deploy deploys into:
 *
 * 1. The one the stage's state names, if Dokploy still has it. State written
 *    before markers existed is trusted — it holds an id this workspace was
 *    given when it created the project — and the marker is written now, so
 *    the project is claimed for the next deploy that has no state.
 * 2. One with this name *and* this identity's marker.
 * 3. A new one, marked.
 *
 * A project that matches by name (in any case) but carries no marker, or
 * another identity's, raises `ProjectNotOwned` — it is never adopted.
 */
export async function resolveProject(
	api: DokployApi,
	identity: DeployIdentity,
	stateProjectId: string | undefined,
	log: (message: string) => void = () => {},
): Promise<ResolvedProject> {
	const name = projectName(identity);
	const marker = ownershipMarker(identity);

	if (stateProjectId) {
		const known = await projectById(api, stateProjectId);
		if (known) {
			const claimed = markerOf(known.description);
			if (claimed && claimed !== marker) {
				throw new ProjectNotOwned(
					known.name,
					known.projectId,
					identity.key,
					claimed,
				);
			}
			if (!claimed) {
				await api.updateProject(known.projectId, {
					name: known.name,
					description: withMarker(known.description, marker),
				});
				log(`   Claimed project ${known.name} for ${identity.key}`);
			}
			return {
				projectId: known.projectId,
				name: known.name,
				environments: known.environments ?? [],
				via: 'state',
			};
		}
	}

	const projects = await api.listProjects();

	// The marker is the proof; the name only narrows the search. Compared in
	// any case so a project created as `Shop` before identities, and claimed
	// through its state since, is still found once that state is gone.
	const owned = projects.find(
		(p) =>
			p.name.toLowerCase() === name.toLowerCase() &&
			isOwnedBy(p.description, identity),
	);
	if (owned) {
		const details = await api.getProject(owned.projectId);
		return {
			projectId: owned.projectId,
			name: owned.name,
			environments: details.environments ?? [],
			via: 'marker',
		};
	}

	// Case-insensitively, because the clash the marker exists to stop is
	// exactly `Shop` and `shop` landing on one server.
	const clash = projects.find(
		(p) => p.name.toLowerCase() === name.toLowerCase(),
	);
	if (clash) {
		throw new ProjectNotOwned(
			clash.name,
			clash.projectId,
			identity.key,
			markerOf(clash.description),
		);
	}

	const created = await api.createProject(
		name,
		withMarker('Deployed by gkm.', marker),
	);
	return {
		projectId: created.project.projectId,
		name: created.project.name,
		environments: [created.environment],
		via: 'created',
	};
}
