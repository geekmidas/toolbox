'use client';

import { format } from 'date-fns';
import {
	Area,
	AreaChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { cn } from '../../../lib/utils';

export interface TimeSeriesDataPoint {
	timestamp: number;
	value: number;
	secondaryValue?: number;
}

export interface AreaTimeSeriesChartProps {
	data: TimeSeriesDataPoint[];
	/** Label for the primary value */
	primaryLabel?: string;
	/** Label for the secondary value (optional) */
	secondaryLabel?: string;
	/** Color for primary series */
	primaryColor?: string;
	/** Color for secondary series */
	secondaryColor?: string;
	/** Time format pattern (date-fns) */
	timeFormat?: string;
	/** Value formatter */
	valueFormatter?: (value: number) => string;
	/** Chart className */
	className?: string;
	/** Show legend */
	showLegend?: boolean;
}

const COLOR_MAP: Record<string, string> = {
	blue: 'hsl(217, 91%, 60%)',
	red: 'hsl(0, 84%, 60%)',
	green: 'hsl(142, 71%, 45%)',
	amber: 'hsl(38, 92%, 50%)',
	purple: 'hsl(263, 70%, 50%)',
};

export function AreaTimeSeriesChart({
	data,
	primaryLabel = 'Value',
	secondaryLabel,
	primaryColor = 'blue',
	secondaryColor = 'red',
	timeFormat = 'HH:mm',
	valueFormatter = (v) => v.toLocaleString(),
	className,
	showLegend,
}: AreaTimeSeriesChartProps) {
	if (data.length === 0) {
		return (
			<div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
				No data available
			</div>
		);
	}

	const hasSecondary =
		secondaryLabel && data.some((p) => p.secondaryValue !== undefined);

	const chartData = data.map((point) => ({
		time: format(new Date(point.timestamp), timeFormat),
		timestamp: point.timestamp,
		[primaryLabel]: point.value,
		...(hasSecondary && secondaryLabel
			? { [secondaryLabel]: point.secondaryValue ?? 0 }
			: {}),
	}));

	const primaryColorValue = COLOR_MAP[primaryColor] ?? primaryColor;
	const secondaryColorValue = COLOR_MAP[secondaryColor] ?? secondaryColor;

	const shouldShowLegend = showLegend ?? hasSecondary;

	return (
		<div className={cn('h-48', className)}>
			<ResponsiveContainer width="100%" height="100%">
				<AreaChart data={chartData}>
					<defs>
						<linearGradient id="primaryGradient" x1="0" y1="0" x2="0" y2="1">
							<stop
								offset="5%"
								stopColor={primaryColorValue}
								stopOpacity={0.3}
							/>
							<stop
								offset="95%"
								stopColor={primaryColorValue}
								stopOpacity={0}
							/>
						</linearGradient>
						{hasSecondary && (
							<linearGradient
								id="secondaryGradient"
								x1="0"
								y1="0"
								x2="0"
								y2="1"
							>
								<stop
									offset="5%"
									stopColor={secondaryColorValue}
									stopOpacity={0.3}
								/>
								<stop
									offset="95%"
									stopColor={secondaryColorValue}
									stopOpacity={0}
								/>
							</linearGradient>
						)}
					</defs>
					<XAxis
						dataKey="time"
						tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
						axisLine={false}
						tickLine={false}
					/>
					<YAxis
						tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
						axisLine={false}
						tickLine={false}
						tickFormatter={valueFormatter}
						width={50}
					/>
					<Tooltip
						content={({ active, payload, label }) => {
							if (!active || !payload?.length) return null;
							return (
								<div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
									<p className="font-medium mb-1">{label}</p>
									{payload.map((entry, index) => (
										<p
											key={index}
											className="flex items-center gap-2 text-muted-foreground"
										>
											<span
												className="w-2 h-2 rounded-full"
												style={{ backgroundColor: entry.color }}
											/>
											{entry.name}: {valueFormatter(entry.value as number)}
										</p>
									))}
								</div>
							);
						}}
					/>
					<Area
						type="monotone"
						dataKey={primaryLabel}
						stroke={primaryColorValue}
						fill="url(#primaryGradient)"
						strokeWidth={2}
					/>
					{hasSecondary && secondaryLabel && (
						<Area
							type="monotone"
							dataKey={secondaryLabel}
							stroke={secondaryColorValue}
							fill="url(#secondaryGradient)"
							strokeWidth={2}
						/>
					)}
				</AreaChart>
			</ResponsiveContainer>
			{shouldShowLegend && (
				<div className="flex justify-center gap-4 mt-2">
					<div className="flex items-center gap-2 text-xs">
						<div
							className="w-3 h-3 rounded-full"
							style={{ backgroundColor: primaryColorValue }}
						/>
						<span className="text-muted-foreground">{primaryLabel}</span>
					</div>
					{hasSecondary && secondaryLabel && (
						<div className="flex items-center gap-2 text-xs">
							<div
								className="w-3 h-3 rounded-full"
								style={{ backgroundColor: secondaryColorValue }}
							/>
							<span className="text-muted-foreground">{secondaryLabel}</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
