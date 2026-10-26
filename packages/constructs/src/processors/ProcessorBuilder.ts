import type { Logger } from '@geekmidas/logger';
import type { Service } from '@geekmidas/services';
import type { StorageClient } from '@geekmidas/storage';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
	type Consumable,
	idsOf,
	type ServicesOf,
	servicesOf,
} from '../construct-interface';
import {
	Processor,
	type ProcessorHandler,
	type ProcessorParams,
} from './Processor';
import type { ParsedPattern } from './pattern';

/** A native package named in a way no installer could resolve. */
export class ProcessorNativeInvalid extends Error {
	constructor(readonly packageName: string) {
		super(
			`'${packageName}' is not a package name. Name the package with native code ` +
				`as it is installed — 'sharp', '@napi-rs/canvas' — and its version ` +
				`is taken from the app's package.json.`,
		);
		this.name = 'ProcessorNativeInvalid';
	}
}

interface ProcessorBuilderState<TLogger extends Logger> {
	parsed: ParsedPattern;
	surfaceId: string;
	bucketId: string;
	origin: Service<string, StorageClient>;
	serves: (key: string) => boolean;
	logger: TLogger;
	paramsSchema?: StandardSchemaV1;
	native: string[];
	services: Service[];
	constructs: string[];
	timeout?: number;
	memorySize?: number;
}

/**
 * What `fileServer.process(pattern)` returns: a processor, built up one
 * immutable step at a time and finished by `.handle()`.
 */
export class ProcessorBuilder<
	TPattern extends string,
	TSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> {
	constructor(private readonly state: ProcessorBuilderState<TLogger>) {}

	/**
	 * The parameters' schema — the allowlist. Every request is parsed by it
	 * before anything runs, and one it refuses is answered 400.
	 */
	params<T extends StandardSchemaV1>(
		schema: T,
	): ProcessorBuilder<TPattern, T, TServices, TLogger> {
		return new ProcessorBuilder({ ...this.state, paramsSchema: schema });
	}

	/** Constructs its handler reaches, as `services.<id>`. */
	dependsOn<const T extends readonly Consumable[]>(
		constructs: T,
	): ProcessorBuilder<
		TPattern,
		TSchema,
		[...TServices, ...ServicesOf<T>],
		TLogger
	> {
		const services = servicesOf(constructs) as unknown as Service[];
		return new ProcessorBuilder({
			...this.state,
			services: [
				...this.state.services.filter(
					(service) =>
						!services.some((s) => s.serviceName === service.serviceName),
				),
				...services,
			],
			constructs: idsOf(constructs, this.state.constructs),
		});
	}

	/**
	 * Packages with native code — `sharp` — installed for the target the
	 * processor runs on rather than bundled: linux in its image, arm64 on
	 * Lambda.
	 */
	native(packages: readonly string[]): this {
		for (const name of packages) {
			if (!/^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/.test(name)) {
				throw new ProcessorNativeInvalid(name);
			}
		}
		return new ProcessorBuilder({
			...this.state,
			native: [...new Set([...this.state.native, ...packages])],
		}) as this;
	}

	/** Milliseconds a request may take, where the target bounds it. */
	timeout(ms: number): this {
		return new ProcessorBuilder({ ...this.state, timeout: ms }) as this;
	}

	/** Megabytes of memory, where the target sets it. */
	memorySize(mb: number): this {
		return new ProcessorBuilder({ ...this.state, memorySize: mb }) as this;
	}

	handle(
		fn: ProcessorHandler<
			ProcessorParams<TPattern, TSchema>,
			TServices,
			TLogger
		>,
	): Processor<TPattern, TSchema, TServices, TLogger> {
		const { state } = this;
		return new Processor<TPattern, TSchema, TServices, TLogger>(
			state.parsed,
			fn,
			{
				surfaceId: state.surfaceId,
				bucketId: state.bucketId,
				origin: state.origin,
				serves: state.serves,
				...(state.paramsSchema
					? { paramsSchema: state.paramsSchema as TSchema }
					: {}),
				native: state.native,
				logger: state.logger,
				services: state.services as TServices,
				constructs: state.constructs,
				...(state.timeout !== undefined ? { timeout: state.timeout } : {}),
				...(state.memorySize !== undefined
					? { memorySize: state.memorySize }
					: {}),
			},
		);
	}
}
