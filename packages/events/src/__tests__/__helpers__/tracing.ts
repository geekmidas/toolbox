import { context, propagation, trace } from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	type ReadableSpan,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';

/**
 * A real tracer provider, registered globally the way a process's telemetry
 * setup registers one — W3C propagation and an async-local context included —
 * exporting into memory.
 */
export function startTracing() {
	const exporter = new InMemorySpanExporter();
	const provider = new NodeTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	provider.register();

	return {
		exporter,
		spans: (): ReadableSpan[] => exporter.getFinishedSpans(),
		async stop() {
			await provider.shutdown();
			trace.disable();
			context.disable();
			propagation.disable();
		},
	};
}
