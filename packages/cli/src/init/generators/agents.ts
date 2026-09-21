import { CONSTRUCTS_GLOB, WORKSPACE_CONSTRUCTS_GLOB } from '../constructs.js';
import type {
	GeneratedFile,
	TemplateConfig,
	TemplateOptions,
} from '../templates/index.js';

/**
 * `AGENTS.md` and `CLAUDE.md` for a scaffolded project.
 *
 * A generated project is the first thing an agent sees, and without this it
 * sees only the output: a `gkm.config.ts` naming three keys, a `constructs/`
 * directory, and a build step that reads both. None of that says what the
 * shape *is*, so an agent reconstructs it from the framework it recognises —
 * and writes an Express app beside a `RestApi`, or restates in config what a
 * construct already declared, which is the exact mistake v10 exists to make
 * impossible.
 *
 * Instructions live in `AGENTS.md` because that is the file every tool reads.
 * `CLAUDE.md` points at it rather than copying it: two files saying the same
 * thing is two files to keep in step, and the copy that drifts is always the
 * one nobody opened.
 *
 * Content is derived from the same `TemplateOptions` the rest of the scaffold
 * is built from, so a project with no database gets no database section, and a
 * worker gets no endpoint guide. A guide that documents what was not generated
 * teaches the reader to distrust it.
 */
export function generateAgentFiles(
	options: TemplateOptions,
	template: TemplateConfig,
): GeneratedFile[] {
	return [
		{ path: 'AGENTS.md', content: agentsContent(options, template) },
		{ path: 'CLAUDE.md', content: claudeContent() },
	];
}

/**
 * The pointer.
 *
 * Deliberately short and deliberately not a summary — a summary is a second
 * copy of the conventions that ages independently of the first.
 */
function claudeContent(): string {
	return `# CLAUDE.md

The conventions for this project live in [AGENTS.md](./AGENTS.md).

Read that file before writing code here. It is the single copy, kept that way
on purpose: anything repeated here would be a second thing to keep in step, and
the stale one is always the copy nobody opened.
`;
}

function agentsContent(
	options: TemplateOptions,
	template: TemplateConfig,
): string {
	const {
		name,
		monorepo,
		database,
		telescope,
		studio,
		packageManager,
		services,
	} = options;
	// A workspace keeps its constructs at the root, beside the apps that share
	// them; a single app keeps them under its own `src/`. Writing the wrong one
	// here would be the first thing a reader checked and the first thing that
	// taught them not to trust the rest.
	const constructsGlob = monorepo ? WORKSPACE_CONSTRUCTS_GLOB : CONSTRUCTS_GLOB;
	const isWorker = template.name === 'worker';
	const isServerless = template.name === 'serverless';
	const run = packageManager === 'npm' ? 'npx' : `${packageManager} exec`;

	const sections: string[] = [];

	sections.push(`# Agent conventions — ${name}

Rules for anyone, human or agent, writing code in this project. Built with
[\`@geekmidas/toolbox\`](https://github.com/geekmidas/toolbox).

Read this before adding a file. Most of what follows exists because the obvious
approach from another framework produces something that compiles, runs, and is
wrong in a way nothing catches.`);

	sections.push(`## The one idea

**Constructs declare; config does not restate.**

A construct — a \`RestApi\`, a database, a bucket, a topic — is the single
declaration of a thing. The build reads those declarations and derives
everything downstream from them: which containers exist, which apps get built,
what the OpenAPI spec says, which env vars a process needs.

\`gkm.config.ts\` holds only what no construct can answer:

\`\`\`typescript
export default defineWorkspace({
  name: '${name}',
  constructs: '${constructsGlob}',
  secrets: { enabled: true },
});
\`\`\`

If you find yourself adding a key to config that names something already
declared in a construct — a path, a port, a route, a container — stop. That is
the drift this design removes. The second copy is the one that goes wrong.`);

	sections.push(`## Layout

\`\`\`
${layoutBlock(options, template)}
\`\`\`

Handlers are found by **one glob**, and what kind a file exports is decided by
the value it exports, not by the directory it sits in.`);

	sections.push(`## Commands

\`\`\`bash
${run} gkm dev            # dev server, hot reload, services up, secrets injected
${run} gkm build          # production build
${run} gkm test           # tests, with secrets injected
${run} gkm exec -- <cmd>  # run any command with secrets injected
${run} gkm openapi        # regenerate the OpenAPI spec
\`\`\`

Secrets are encrypted at rest and injected at run time:

\`\`\`bash
${run} gkm secrets:set DATABASE_URL postgres://...
${run} gkm secrets:show
\`\`\`

**Never run a tool that needs project env vars directly.** It will see an empty
environment and fail in a way that looks like a config bug. Go through
\`gkm exec --\`, which is what injects them.`);

	if (!isWorker) sections.push(endpointSection(options));
	if (isWorker || isServerless || services.events)
		sections.push(backgroundSection(template));
	if (database) sections.push(databaseSection());

	sections.push(`## Environment

Environment is parsed once, through \`envkit\`, and never read from
\`process.env\` directly:

\`\`\`typescript
import { EnvironmentParser } from '@geekmidas/envkit';
import { Credentials } from '@geekmidas/envkit/credentials';

export const envParser = new EnvironmentParser({
  ...process.env,
  ...Credentials,
});

export const config = envParser
  .create((get) => ({
    port: get('PORT').string().transform(Number).default(3000),
  }))
  .parse();
\`\`\`

\`Credentials\` is what \`gkm dev\` and \`gkm exec\` inject. A bare
\`process.env.FOO\` bypasses both the decryption and the validation, so it reads
as \`undefined\` in exactly the environments that matter.`);

	sections.push(conventionsSection());
	sections.push(testingSection(database));

	if (telescope || studio) {
		const tools = [
			telescope && '**Telescope** — request and exception monitoring',
			studio && '**Studio** — dev dashboard and database browser',
		].filter(Boolean);

		sections.push(`## Dev tools

${tools.map((t) => `- ${t}`).join('\n')}

Both are derived from declared constructs. Neither needs wiring up by hand.`);
	}

	sections.push(`## Before you say it works

\`\`\`bash
${run} gkm build
\`\`\`

A build is the only thing that proves the manifest still resolves. Code that
typechecks can still declare two constructs with one id, or a handler no glob
reaches — and neither shows up until something reads the graph.`);

	return `${sections.join('\n\n')}\n`;
}

function layoutBlock(
	options: TemplateOptions,
	template: TemplateConfig,
): string {
	const { monorepo, apiPath, database } = options;
	const isWorker = template.name === 'worker';

	if (monorepo) {
		return `constructs/          # every construct: the surface, the database, topics
${apiPath}/            # the API app
gkm.config.ts        # name, constructs glob, secrets`;
	}

	const lines = [
		'src/constructs/      # the surface, and anything it declares',
		'src/config/          # env parser, logger',
	];

	if (!isWorker) lines.push('src/endpoints/       # HTTP handlers');
	if (isWorker) {
		lines.push('src/crons/           # scheduled work');
		lines.push('src/subscribers/     # topic consumers');
	}
	if (database) lines.push('src/db/              # migrations, schema');

	lines.push('gkm.config.ts        # name, constructs glob, secrets');

	return lines.join('\n');
}

function endpointSection(options: TemplateOptions): string {
	const { database } = options;

	return `## Adding an endpoint

An endpoint is built **from the surface that serves it**. That is where its
logger, environment parser and authorizers come from, so none of them is passed
per endpoint:

\`\`\`typescript
import { z } from 'zod';
import { router } from '../constructs/router.ts';

export const createUser = router
  .post('/users')
  .body(z.object({ name: z.string(), email: z.email() }))
  .output(z.object({ id: z.uuid() }))
  .handle(async ({ body, logger${database ? ', services' : ''} }) => {
    logger.info({ name: body.name }, 'creating user');
${
	database
		? `    const user = await services.database
      .insertInto('users')
      .values({ name: body.name, email: body.email })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { id: user.id };`
		: `    return { id: crypto.randomUUID() };`
}
  });
\`\`\`

**Export it.** An endpoint that is never exported is never found — the glob
loads the module and filters by value, so a handler assigned to a local
\`const\` simply does not exist as far as the build is concerned.

**Do not write an HTTP server.** No \`express()\`, no \`new Hono()\`, no
\`app.listen\`. The entry is generated from the surface; a hand-written server
beside it is a second app that shadows the real one.

### Branching the factory

Share what a *group* of endpoints needs by branching once, in its own file:

\`\`\`typescript
export const router = api.endpoints${database ? '.database(database)' : ''};
export const sessionRouter = router.session(/* … */);
\`\`\`

Branch for a group, never for a single endpoint — a one-endpoint branch is
indirection with nothing on the other side of it.`;
}

function backgroundSection(template: TemplateConfig): string {
	const isWorker = template.name === 'worker';

	return `## Background work

Crons, subscribers and functions are declared the same way endpoints are: as
exported values the build discovers.

\`\`\`typescript
// a scheduled job
import { c } from '@geekmidas/constructs/crons';

export const cleanup = c
  .schedule('rate(1 day)')
  .handle(async ({ logger }) => {
    logger.info('cleaning up');
  });
\`\`\`

\`\`\`typescript
// a topic subscriber
import { s } from '@geekmidas/constructs/subscribers';
import { userEvents } from '../constructs/topics.ts';

export const onUserCreated = s
  .topic(userEvents)
  .subscribe(['user.created'])
  .handle(async ({ events, logger }) => {
    logger.info({ count: events.length }, 'handling user events');
  });
\`\`\`

Handlers receive a **batch**, not one event. Both transports deliver in
batches, so a per-event round trip is a round trip per event for no reason.

${
	isWorker
		? `This project is background work and nothing else — there is no HTTP surface
to add routes to.`
		: `Declaring a topic is what makes the broker exist. Nothing lists it in config.`
}`;
}

function databaseSection(): string {
	return `## Database

The database is a **construct**, not a hand-rolled service. Declaring it is what
makes a Postgres exist locally and a database exist on deploy — nothing names
\`postgres\` in config.

An endpoint reaches it by declaring the dependency, and gets it typed:

\`\`\`typescript
export const listUsers = router
  .get('/users')
  .output(z.array(z.object({ id: z.uuid() })))
  .handle(async ({ services }) => {
    return services.database.selectFrom('users').selectAll().execute();
  });
\`\`\`

Queries go through Kysely. Never open your own connection pool — the one the
construct provides is the one that gets credentials, pooling and shutdown.`;
}

function conventionsSection(): string {
	return `## Conventions

**Zod formats are top-level schemas.**

\`\`\`typescript
// yes
z.email()
z.url()
z.uuid()

// no
z.string().email()
z.string().url()
\`\`\`

Zod 4 made each format a schema in its own right. The chained form still runs,
but it types as a \`ZodString\` carrying a check, so it cannot be composed or
narrowed — and it emits different JSON Schema, which means a published API
contract would depend on which spelling someone reached for.

\`envkit\` is not affected: \`get('ADMIN_EMAIL').string().email()\` is its own
builder, not Zod's. Leave it alone.

**Style.** Two-space indent, single quotes, semicolons, trailing commas, 80
columns. \`import type\` for type-only imports. Run the formatter rather than
matching it by hand.

**Construct ids are unique.** Two constructs sharing an id fails discovery for
the whole project, not just the second one.`;
}

function testingSection(database: boolean): string {
	return `## Testing

**Integration over unit.** Prefer the real dependency to a mock — a real
database, a real cache. Mocks are for things you genuinely cannot run:
the filesystem, the clock, external HTTP (use MSW for that).

**Test behaviour, not implementation.** Assert what the code did, not which
functions it called on the way.

\`\`\`bash
${database ? 'gkm test       # starts services, injects secrets, then runs vitest' : 'gkm test'}
\`\`\`

Run tests through \`gkm test\`, not \`vitest\` directly${
		database
			? ' — it is what starts the database and injects the secrets the suite needs'
			: ''
	}.`;
}
