/** Percentiles of a set of samples, in the unit they were taken in. */
export interface Distribution {
	count: number;
	min: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
	mean: number;
}

export function distribution(samples: readonly number[]): Distribution {
	if (samples.length === 0) {
		return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
	}
	const sorted = Float64Array.from(samples).sort();
	const at = (q: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
	let sum = 0;
	for (const value of sorted) sum += value;
	return {
		count: sorted.length,
		min: sorted[0]!,
		p50: at(0.5),
		p95: at(0.95),
		p99: at(0.99),
		max: sorted[sorted.length - 1]!,
		mean: sum / sorted.length,
	};
}

/** The fields a printed report needs — one simulator's, or several pooled. */
export interface Printable {
	generator: string;
	asked: number;
	opened: number;
	openAtEnd: number;
	failures: Record<string, number>;
	unexpectedCloses: Record<string, number>;
	rampSeconds: number;
	connectMs: Distribution;
	rttMs: Distribution;
	rttLost: number;
	broadcasts: {
		seq: number;
		received: number;
		expected: number;
		allMs: number;
		latencyMs: Distribution;
	}[];
	server: {
		after: { instance: string; sockets: number; rss: number }[];
	};
	bytesPerConnection?: number;
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

export function printTable(reports: readonly Printable[]): void {
	for (const report of reports) {
		const rows: [string, string][] = [
			['generator', report.generator],
			[
				'sockets',
				`${report.opened} opened of ${report.asked}, ${report.openAtEnd} open at the end`,
			],
			['ramp', `${report.rampSeconds.toFixed(1)} s`],
			['failures', JSON.stringify(report.failures)],
			['unexpected closes', JSON.stringify(report.unexpectedCloses)],
			[
				'connect',
				`p50 ${ms(report.connectMs.p50)}  p95 ${ms(report.connectMs.p95)}  p99 ${ms(report.connectMs.p99)}  max ${ms(report.connectMs.max)}`,
			],
			[
				'echo RTT',
				`p50 ${ms(report.rttMs.p50)}  p95 ${ms(report.rttMs.p95)}  p99 ${ms(report.rttMs.p99)}  (${report.rttMs.count} samples, ${report.rttLost} lost)`,
			],
			...report.broadcasts.map((b, i): [string, string] => [
				`broadcast ${i + 1}`,
				`${b.received}/${b.expected} in ${ms(b.allMs)}  p50 ${ms(b.latencyMs.p50)}  p99 ${ms(b.latencyMs.p99)}`,
			]),
			...report.server.after.map((s): [string, string] => [
				`server ${s.instance}`,
				`${s.sockets} sockets, RSS ${(s.rss / 1024 / 1024).toFixed(1)} MB`,
			]),
			[
				'RSS / connection',
				report.bytesPerConnection
					? `${(report.bytesPerConnection / 1024).toFixed(1)} KB`
					: 'n/a',
			],
		];
		const width = Math.max(...rows.map(([label]) => label.length));
		console.log(
			rows
				.map(([label, value]) => `${label.padEnd(width)}  ${value}`)
				.join('\n'),
		);
		console.log('');
	}
}
