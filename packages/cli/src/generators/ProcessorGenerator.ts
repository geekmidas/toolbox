import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Processor } from '@geekmidas/constructs/processors';
import type { ProcessorInfo } from '@geekmidas/manifest';
import type { BuildContext } from '../build/types';
import { processorUnitName } from '../build/workers';
import {
	ORIGIN_VERIFY_HEADER,
	PROCESSOR_ORIGIN_SECRET_ENV,
} from '../providers/processorOrigin';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';
import { PROCESSORS_DEV_PREFIX } from './processorRoute';
import {
	startTelemetryCode,
	type TelemetryContext,
	writeTelemetryModule,
} from './telemetry';

type AnyProcessor = Processor<string, any, any, any>;

/** Where a file server's processor entry lives, under an app's `.gkm/server`. */
export function processorEntryDir(
	serverDir: string,
	fileServerId: string,
): string {
	return join(serverDir, 'processors', processorUnitName(fileServerId));
}

/** The file its bundle is written to, beside the server's. */
export function processorBundleName(fileServerId: string): string {
	return `${processorUnitName(fileServerId)}.mjs`;
}

/**
 * A file server's processors, as the build generates them.
 *
 * On AWS each is a Lambda behind a function URL — the CDN's origin for its
 * pattern. On a server they are one process per file server, the processor
 * unit (see {@link ProcessorGenerator.buildEntry}), so the `server` target
 * generates nothing per processor here.
 */
export class ProcessorGenerator extends ConstructGenerator<
	AnyProcessor,
	ProcessorInfo[]
> {
	isConstruct(value: unknown): value is AnyProcessor {
		return Processor.isProcessor(value);
	}

	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<AnyProcessor>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<ProcessorInfo[]> {
		if ((options?.target ?? 'aws') !== 'aws' || constructs.length === 0) {
			return [];
		}

		const dir = join(outputDir, 'processors');
		await mkdir(dir, { recursive: true });

		const infos: ProcessorInfo[] = [];
		for (const { key, construct, path } of constructs) {
			const file = join(dir, `${key}.ts`);
			const importPath = relative(dirname(file), path.relative).replace(
				/\.ts$/,
				'.js',
			);
			await writeFile(
				file,
				`import { AWSLambdaProcessor } from '@geekmidas/constructs/processors';
import { ${key} } from '${importPath}';
${context.storageDrivers?.imports ?? ''}
${context.storageDrivers?.setup ? `\n// The handler registers the drivers its target needs.\n${context.storageDrivers.setup}\n` : ''}
const adapter = new AWSLambdaProcessor(${key});

export const handler = adapter.handler;
`,
			);
			infos.push(
				await processorInfo(
					key,
					construct,
					relative(options?.root ?? process.cwd(), file).replace(
						/\.ts$/,
						'.handler',
					),
					context,
				),
			);
		}
		return infos;
	}

	/**
	 * `gkm dev`'s half: `processors.ts` beside the dev server's app, mounting
	 * each file server's processors under `/__gkm/processors/<FileServer>`.
	 * The local edge sends each pattern on the file server's host there, so
	 * `processedUrl()` answers locally as it does deployed.
	 *
	 * In the dev server's own process rather than a unit of its own: locally
	 * there is no CPU to protect, and the dev server already reloads on change.
	 */
	async buildDev(
		outputDir: string,
		processors: GeneratedConstruct<AnyProcessor>[],
	): Promise<string> {
		await mkdir(outputDir, { recursive: true });
		const file = join(outputDir, 'processors.ts');

		const imports = processors
			.map(({ key, path }) => {
				const specifier = relative(outputDir, path.absolute).replace(
					/\.ts$/,
					'.js',
				);
				return `import { ${key} } from '${specifier.startsWith('.') ? specifier : `./${specifier}`}';`;
			})
			.join('\n');
		const byServer = new Map<string, string[]>();
		for (const { key, construct } of processors) {
			byServer.set(construct.surfaceId, [
				...(byServer.get(construct.surfaceId) ?? []),
				key,
			]);
		}
		const units = [...byServer.entries()]
			.map(([id, keys]) => `    ${JSON.stringify(id)}: [${keys.join(', ')}],`)
			.join('\n');

		await writeFile(
			file,
			`/**
 * Generated processors setup for \`gkm dev\`.
 *
 * Each file server's processors, under ${PROCESSORS_DEV_PREFIX}<FileServer>: the
 * local edge rewrites each processor pattern on the file server's host here.
 */
import type { EnvironmentParser } from '@geekmidas/envkit';
import { processorServer } from '@geekmidas/constructs/processors';
${imports}

export function setupProcessors(
  app: { all: (path: string, handler: (c: any) => unknown) => unknown },
  envParser: EnvironmentParser<any>,
): void {
  const units: Record<string, ReturnType<typeof processorServer>> = Object.fromEntries(
    Object.entries({
${units}
    }).map(([id, processors]) => [id, processorServer(processors, envParser)]),
  );

  app.all('${PROCESSORS_DEV_PREFIX}:server/*', async (c: any) => {
    const server = c.req.param('server') as string;
    const serve = units[server];
    if (!serve) return c.notFound();
    const path = c.req.path.slice(\`${PROCESSORS_DEV_PREFIX}\${server}\`.length) || '/';
    const response = await serve({ method: c.req.method, path });
    if (!response) {
      return new Response(null, {
        status: 404,
        headers: { 'cache-control': 'public, max-age=60' },
      });
    }
    return new Response(c.req.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  });
}
`,
		);
		return file;
	}

	/**
	 * A file server's processor unit: one process answering each of its
	 * processors' patterns, and `/health`. Returns its entry, `processors.ts`.
	 *
	 * Its own process because making a derivative is CPU-bound — a resize
	 * spike in the API's process would be every request's latency.
	 */
	async buildEntry(input: {
		context: BuildContext;
		fileServerId: string;
		outputDir: string;
		processors: GeneratedConstruct<AnyProcessor>[];
		/** From the file server's edge to a `Telemetry` node, when it has one. */
		telemetry?: TelemetryContext;
	}): Promise<string> {
		const { context, outputDir, processors } = input;
		await mkdir(outputDir, { recursive: true });
		// The file server's own edge decides; without one the module loads
		// nothing, and the entry's start-up is the same shape either way.
		await writeTelemetryModule(outputDir, input.telemetry);

		const healthCheck = context.production?.healthCheck ?? '/health';
		const imports = processors
			.map(({ key, path }) => {
				const specifier = relative(outputDir, path.absolute).replace(
					/\.ts$/,
					'.js',
				);
				return `import { ${key} } from '${specifier.startsWith('.') ? specifier : `./${specifier}`}';`;
			})
			.join('\n');

		const entry = join(outputDir, 'processors.ts');
		await writeFile(
			entry,
			`#!/usr/bin/env node
/**
 * Production entry for ${input.fileServerId}'s processors.
 * Generated by 'gkm build --production'.
 *
 * Answers each processor's pattern, and ${healthCheck} on PORT. The edge
 * routes only those patterns here; everything else on the file server's
 * domain is the bucket.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { runShutdownHooks } from '@geekmidas/constructs';
import { processorServer } from '@geekmidas/constructs/processors';
${context.storageDrivers?.imports ?? ''}
${imports}

${startTelemetryCode([healthCheck])}
${context.storageDrivers?.setup ? `// The entry point registers the drivers its target needs.\n${context.storageDrivers.setup}\n` : ''}
process.env.GKM_APP_NAME ??= ${JSON.stringify(processorUnitName(input.fileServerId))};

const processors = [${processors.map(({ key }) => key).join(', ')}];
const serve = processorServer(processors);
const port = Number(process.env.PORT) || 3000;
let stopping = false;

${input.telemetry ? REQUEST_SPANS : NO_REQUEST_SPANS}
// Where the CDN fronts this unit, the secret it adds to every request: one
// without it is refused here, whatever the edge in front did or could not.
const originSecret = process.env.${PROCESSOR_ORIGIN_SECRET_ENV}
  ? Buffer.from(process.env.${PROCESSOR_ORIGIN_SECRET_ENV})
  : undefined;
const fromOrigin = (header: string | string[] | undefined) => {
  if (!originSecret) return true;
  const given = Buffer.from(typeof header === 'string' ? header : '');
  return given.length === originSecret.length && timingSafeEqual(given, originSecret);
};

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (path === ${JSON.stringify(healthCheck)}) {
    res.writeHead(stopping ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: stopping ? 'stopping' : 'ok' }));
    return;
  }
  if (!fromOrigin(req.headers[${JSON.stringify(ORIGIN_VERIFY_HEADER.toLowerCase())}])) {
    res.writeHead(403, { 'cache-control': 'no-store' }).end();
    return;
  }
  await traced(method, path, async () => {
    try {
      const response = await serve({ method, path });
      if (!response) {
        res.writeHead(404, { 'cache-control': 'public, max-age=60' }).end();
        return 404;
      }
      res.writeHead(response.status, response.headers);
      res.end(method === 'HEAD' ? undefined : response.body);
      return response.status;
    } catch (error) {
      console.error(error);
      res.writeHead(500, { 'cache-control': 'no-store' }).end();
      return 500;
    }
  });
});
server.listen(port);

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), Number(process.env.GKM_SHUTDOWN_TIMEOUT_MS) || 8000).unref();
  server.close();
  await runShutdownHooks((error) => console.error(error));
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`,
		);
		return entry;
	}
}

/**
 * A SERVER span per request, once telemetry has started — opened by the unit
 * rather than by hooking node:http, which sees nothing inside a bundle. Named
 * after the processor's pattern, never the key, which has no bound.
 *
 * Only in an entry whose file server has a `Telemetry` node: the bundle
 * follows the import, and an app without one need not install the API.
 */
const REQUEST_SPANS = `const tracing = requestSpans ? await import('@opentelemetry/api') : undefined;
const routeOf = (path: string) =>
  processors.find((processor) => path.startsWith(processor.prefix))?.pattern;

async function traced(
  method: string,
  path: string,
  run: () => Promise<number>,
): Promise<void> {
  if (!tracing) {
    await run();
    return;
  }
  const route = routeOf(path);
  await tracing.trace.getTracer('@geekmidas/processors').startActiveSpan(
    route ? \`\${method} \${route}\` : method,
    {
      kind: tracing.SpanKind.SERVER,
      attributes: {
        'http.request.method': method,
        'url.path': path,
        ...(route ? { 'http.route': route } : {}),
      },
    },
    async (span) => {
      try {
        const status = await run();
        span.setAttribute('http.response.status_code', status);
        if (status >= 500) span.setStatus({ code: tracing.SpanStatusCode.ERROR });
      } finally {
        span.end();
      }
    },
  );
}
`;

/** The same shape without telemetry: each request just runs. */
const NO_REQUEST_SPANS = `async function traced(
  _method: string,
  _path: string,
  run: () => Promise<number>,
): Promise<void> {
  await run();
}
`;

/** What the manifest records of one processor. */
export async function processorInfo(
	name: string,
	processor: AnyProcessor,
	handler: string,
	context: Pick<BuildContext, 'markOptional'>,
): Promise<ProcessorInfo> {
	return {
		name,
		handler,
		fileServer: processor.surfaceId,
		path: processor.pattern,
		prefix: processor.prefix,
		...(processor.native.length ? { native: [...processor.native] } : {}),
		...(processor.timeout !== undefined ? { timeout: processor.timeout } : {}),
		...(processor.memorySize !== undefined
			? { memorySize: processor.memorySize }
			: {}),
		environment: await processor.getEnvironment({
			markOptional: context.markOptional,
		}),
		dependencies: processor.constructs,
	};
}
