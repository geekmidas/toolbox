'use client';

import { subDays, subHours } from 'date-fns';
import { cn } from '../../../lib/utils';

export type TimeRangePreset = '1h' | '6h' | '24h' | '7d' | 'custom';

export interface TimeRange {
	preset: TimeRangePreset;
	start: Date;
	end: Date;
}

export interface TimeRangeSelectorProps {
	value: TimeRange;
	onChange: (range: TimeRange) => void;
	/** Available presets (default: all) */
	presets?: Array<{ label: string; value: TimeRangePreset }>;
	/** Show date picker icon */
	showIcon?: boolean;
	/** Class name */
	className?: string;
}

const defaultPresets: Array<{ label: string; value: TimeRangePreset }> = [
	{ label: '1h', value: '1h' },
	{ label: '6h', value: '6h' },
	{ label: '24h', value: '24h' },
	{ label: '7d', value: '7d' },
];

function getPresetRange(preset: TimeRangePreset): { start: Date; end: Date } {
	const end = new Date();

	switch (preset) {
		case '1h':
			return { start: subHours(end, 1), end };
		case '6h':
			return { start: subHours(end, 6), end };
		case '24h':
			return { start: subHours(end, 24), end };
		case '7d':
			return { start: subDays(end, 7), end };
		default:
			return { start: subHours(end, 1), end };
	}
}

export function TimeRangeSelector({
	value,
	onChange,
	presets = defaultPresets,
	className,
}: TimeRangeSelectorProps) {
	const handlePresetClick = (preset: TimeRangePreset) => {
		const range = getPresetRange(preset);
		onChange({ preset, ...range });
	};

	return (
		<div className={cn('flex items-center gap-2', className)}>
			{/* Preset buttons */}
			<div className="flex rounded-md border border-border overflow-hidden">
				{presets.map(({ label, value: preset }, index) => (
					<button
						key={preset}
						type="button"
						onClick={() => handlePresetClick(preset)}
						className={cn(
							'px-3 py-1.5 text-sm font-medium transition-colors',
							value.preset === preset
								? 'bg-primary text-primary-foreground'
								: 'bg-card hover:bg-muted text-foreground',
							index > 0 && 'border-l border-border',
						)}
					>
						{label}
					</button>
				))}
			</div>
		</div>
	);
}

/**
 * Create a time range from a preset
 */
export function createTimeRange(preset: TimeRangePreset = '1h'): TimeRange {
	const range = getPresetRange(preset);
	return { preset, ...range };
}
