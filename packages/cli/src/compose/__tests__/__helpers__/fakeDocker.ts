import { createHash } from 'node:crypto';
import type { ComposeDocker, ImageLookup, StackRef } from '../../docker';

/**
 * Docker, the registry and the health probe as recorders, for asserting the
 * order a stack is brought up in without a daemon.
 */

export interface Call {
	op: string;
	args?: unknown;
}

export function fakeDocker(options: { registry?: readonly string[] } = {}) {
	const calls: Call[] = [];
	const docker: ComposeDocker = {
		async lookup(ref): Promise<ImageLookup> {
			calls.push({ op: 'lookup', args: ref });
			return options.registry?.includes(ref)
				? { ref, status: 'found' }
				: { ref, status: 'missing' };
		},
		async build(_stack: StackRef, services) {
			calls.push({ op: 'build', args: [...services] });
		},
		async pull(_stack, services) {
			calls.push({ op: 'pull', args: [...services] });
		},
		async up(stack, services) {
			calls.push({ op: 'up', args: services ? [...services] : 'all' });
			void stack;
		},
		async down(stack) {
			calls.push({ op: 'down', args: stack.project });
		},
		async port(_stack, service, inside) {
			calls.push({ op: 'port', args: [service, inside] });
			return 55432;
		},
		async health(_stack, service) {
			calls.push({ op: 'health', args: service });
			return 'healthy';
		},
		async copyOut(_stack, service, from) {
			calls.push({ op: 'copyOut', args: [service, from] });
		},
		async push(_stack, ref) {
			calls.push({ op: 'push', args: ref });
			return fakeDigest(ref);
		},
		async digest(ref) {
			return `sha256:${ref.length.toString(16).padStart(4, '0')}`;
		},
	};
	return { docker, calls, ops: () => calls.map((call) => call.op) };
}

/** The digest the fake registry stores a pushed `ref` under: 64 hex. */
export function fakeDigest(ref: string): string {
	return `sha256:${createHash('sha256').update(ref).digest('hex')}`;
}

/** A probe every app answers 200 to, recorded beside docker's calls. */
export function answering(calls: Call[]) {
	return async ({ url }: { url: string }) => {
		calls.push({ op: 'probe', args: url });
		return 200;
	};
}
