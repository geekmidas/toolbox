import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
	composeFor,
	toYaml,
	UnassignedPort,
	UnknownContainer,
} from '../compose';
import { portKeys } from '../containers';
import type { Plan } from '../plan';

const plan = (containers: string[]): Plan => ({
	stage: 'development',
	containers,
	resources: [],
});

/** Every port key the plan needs, numbered from 20000 so they are recognisable. */
const portsFor = (containers: string[]) =>
	Object.fromEntries(
		portKeys(containers).map((key, index) => [key, 20000 + index]),
	);

const compose = (containers: string[], images?: Record<string, string>) =>
	composeFor(plan(containers), {
		project: 'toolbox',
		ports: portsFor(containers),
		...(images ? { images } : {}),
	});

describe('composeFor', () => {
	it('emits a service per planned container', () => {
		expect(Object.keys(compose(['postgres', 'minio']).services)).toEqual([
			'minio',
			'postgres',
		]);
	});

	it('emits nothing for an empty plan', () => {
		expect(compose([]).services).toEqual({});
	});

	it('names the compose project', () => {
		// Compose derives one from the directory otherwise, so two checkouts of
		// the same repo would fight over one set of containers.
		expect(compose(['postgres']).name).toBe('toolbox');
	});

	it('publishes the assigned port, never the image default', () => {
		// The whole point of allocation: one container publishing 5432 means the
		// second project on the machine cannot start.
		const { services } = compose(['postgres']);

		expect(services.postgres.ports).toEqual(['20000:5432']);
	});

	it('gives each of a container’s ports its own assignment', () => {
		// Not an offset from the first — otherwise MinIO's console lands on
		// whatever was allocated to the next container.
		const { services } = compose(['minio']);

		expect(services.minio.ports).toEqual(['20000:9000', '20001:9001']);
	});

	it('publishes the mail inbox as well as SMTP', () => {
		// An inbox you can open is most of why Mailpit rather than a stub.
		expect(compose(['mailpit']).services.mailpit.ports).toEqual([
			'20000:1025',
			'20001:8025',
		]);
	});

	it('takes its default image from the container', () => {
		expect(compose(['postgres']).services.postgres.image).toBe(
			'postgres:18-alpine',
		);
	});

	it('lets config override an image', () => {
		// The config half of the split: which containers is derived, which image
		// stays explicit — a project needing postgis says so.
		const { services } = compose(['postgres'], {
			postgres: 'postgis/postgis:18-3.5',
		});

		expect(services.postgres.image).toBe('postgis/postgis:18-3.5');
	});

	it('declares a volume for containers whose data should survive', () => {
		expect(compose(['postgres', 'minio']).volumes).toEqual({
			'postgres-data': {},
			'minio-data': {},
		});
	});

	it('mounts the postgres volume where 18 keeps its cluster', () => {
		// The 18 image keeps its data in a version-named subdirectory and refuses
		// to start when a volume is mounted over the legacy `data` path, so this
		// is the difference between a container that starts and one that does not.
		expect(compose(['postgres']).services.postgres.volumes).toEqual([
			'postgres-data:/var/lib/postgresql',
		]);
	});

	it('declares no volume for mail', () => {
		// Local mail is disposable; an inbox surviving days of dev is noise.
		expect(compose(['mailpit']).volumes).toBeUndefined();
	});

	it('health-checks every container it emits', () => {
		// Reconcile waits on health, so a container without one is a container
		// the loop cannot know is ready.
		for (const service of Object.values(
			compose([
				'postgres',
				'minio',
				'mailpit',
				'redis',
				'rabbitmq',
				'localstack',
			]).services,
		)) {
			expect(service.healthcheck).toBeDefined();
		}
	});

	it('creates no bucket in the MinIO entrypoint', () => {
		// Bucket names are planned resources; putting them here would restore the
		// hand-maintained declaration this change removes.
		expect(compose(['minio']).services.minio.command).not.toContain('mkdir');
	});

	it('prefixes localstack credentials as it requires', () => {
		const { environment } = compose(['localstack']).services.localstack;

		expect(environment?.AWS_ACCESS_KEY_ID).toMatch(/^LSIA/);
	});

	it('refuses a container it has no image for', () => {
		expect(() => compose(['cassandra'])).toThrow(UnknownContainer);
	});

	it('refuses to emit a container whose port was never assigned', () => {
		expect(() =>
			composeFor(plan(['postgres']), { project: 'toolbox', ports: {} }),
		).toThrow(UnassignedPort);
	});

	it('states the rule and carries the value as a field', () => {
		try {
			compose(['cassandra']);
			expect.unreachable();
		} catch (error) {
			const failure = error as UnknownContainer;
			expect(failure.message).toBe(
				'No image is known for this container; pin one in config',
			);
			expect(failure.container).toBe('cassandra');
			expect(failure.known).toContain('postgres');
		}
	});

	it('is deterministic — the same plan yields the same document', () => {
		// So the plan hash means something and a converged reconcile rewrites
		// nothing.
		expect(compose(['minio', 'postgres'])).toEqual(
			compose(['postgres', 'minio']),
		);
	});
});

describe('toYaml', () => {
	it('round-trips through a YAML parser', () => {
		const file = compose(['postgres', 'minio']);

		expect(parse(toYaml(file))).toEqual(file);
	});

	it('says it is generated and where to make changes', () => {
		expect(toYaml(compose(['postgres']))).toMatch(/Generated by gkm/);
	});
});
