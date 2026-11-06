import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { stackTelemetry, TelemetryNodesDisagree } from '../edges';

const node = (id: string, extra: Record<string, string> = {}) => ({
	kind: 'telemetry' as const,
	id,
	...extra,
});

describe("the stack's one OpenObserve, as the Telemetry nodes declare it", () => {
	it("answers on the node's id kebab-cased, and runs the pinned image", () => {
		expect(
			stackTelemetry({ Telemetry: node('Telemetry') } as ConstructManifest),
		).toEqual({ label: 'telemetry' });
		expect(
			stackTelemetry({ AppTraces: node('AppTraces') } as ConstructManifest),
		).toEqual({ label: 'app-traces' });
	});

	it('takes the subdomain and the image a node names', () => {
		expect(
			stackTelemetry({
				Telemetry: node('Telemetry', { subdomain: 'logs', image: 'oo:v2' }),
			} as ConstructManifest),
		).toEqual({ label: 'logs', image: 'oo:v2' });
	});

	it('is telemetry with no node at all', () => {
		expect(stackTelemetry({} as ConstructManifest)).toEqual({
			label: 'telemetry',
		});
	});

	it('refuses two nodes that give it different labels or images', () => {
		expect(() =>
			stackTelemetry({
				Telemetry: node('Telemetry'),
				Traces: node('Traces'),
			} as ConstructManifest),
		).toThrow(TelemetryNodesDisagree);
		expect(() =>
			stackTelemetry({
				Telemetry: node('Telemetry', { image: 'oo:v1' }),
				Traces: node('Traces', { subdomain: 'telemetry', image: 'oo:v2' }),
			} as ConstructManifest),
		).toThrow(/Telemetry, Traces give it different images/);
		expect(
			stackTelemetry({
				Telemetry: node('Telemetry', { image: 'oo:v1' }),
				Traces: node('Traces', { subdomain: 'telemetry' }),
			} as ConstructManifest),
		).toEqual({ label: 'telemetry', image: 'oo:v1' });
	});
});
