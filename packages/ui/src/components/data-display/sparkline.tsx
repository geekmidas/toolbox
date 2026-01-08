'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SparklineProps extends React.SVGAttributes<SVGSVGElement> {
	/** Array of data points */
	data: number[];
	/** Width of the sparkline */
	width?: number;
	/** Height of the sparkline */
	height?: number;
	/** Stroke color */
	color?: string;
	/** Stroke width */
	strokeWidth?: number;
	/** Whether to show filled area under the line */
	filled?: boolean;
	/** Fill opacity (0-1) */
	fillOpacity?: number;
	/** Whether to show dots at data points */
	showDots?: boolean;
	/** Whether to curve the line */
	curved?: boolean;
	/** Minimum value (defaults to min of data) */
	min?: number;
	/** Maximum value (defaults to max of data) */
	max?: number;
}

const Sparkline = React.forwardRef<SVGSVGElement, SparklineProps>(
	(
		{
			className,
			data,
			width = 100,
			height = 32,
			color = 'currentColor',
			strokeWidth = 2,
			filled = false,
			fillOpacity = 0.2,
			showDots = false,
			curved = true,
			min: minProp,
			max: maxProp,
			...props
		},
		ref,
	) => {
		if (data.length === 0) {
			return (
				<svg
					ref={ref}
					className={cn('text-accent', className)}
					width={width}
					height={height}
					viewBox={`0 0 ${width} ${height}`}
					{...props}
				/>
			);
		}

		const min = minProp ?? Math.min(...data);
		const max = maxProp ?? Math.max(...data);
		const range = max - min || 1;

		const padding = strokeWidth;
		const chartWidth = width - padding * 2;
		const chartHeight = height - padding * 2;

		// Calculate points
		const points = data.map((value, index) => {
			const x = padding + (index / (data.length - 1 || 1)) * chartWidth;
			const y = padding + chartHeight - ((value - min) / range) * chartHeight;
			return { x, y };
		});

		// Create path
		let pathD: string;
		if (curved && points.length > 2) {
			// Curved line using quadratic bezier curves
			pathD = points.reduce((acc, point, index) => {
				if (index === 0) {
					return `M ${point.x},${point.y}`;
				}
				const prev = points[index - 1]!;
				const cpX = (prev.x + point.x) / 2;
				return `${acc} Q ${prev.x},${prev.y} ${cpX},${(prev.y + point.y) / 2} T ${point.x},${point.y}`;
			}, '');
		} else {
			// Straight lines
			pathD = points
				.map((point, index) =>
					index === 0 ? `M ${point.x},${point.y}` : `L ${point.x},${point.y}`,
				)
				.join(' ');
		}

		// Create fill path
		const fillPathD = filled
			? `${pathD} L ${points[points.length - 1]?.x},${height - padding} L ${points[0]?.x},${height - padding} Z`
			: '';

		return (
			<svg
				ref={ref}
				className={cn('text-accent', className)}
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				{...props}
			>
				{filled && (
					<path
						d={fillPathD}
						fill={color}
						opacity={fillOpacity}
						strokeWidth={0}
					/>
				)}
				<path
					d={pathD}
					fill="none"
					stroke={color}
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				{showDots &&
					points.map((point, index) => (
						<circle
							key={index}
							cx={point.x}
							cy={point.y}
							r={strokeWidth + 1}
							fill={color}
						/>
					))}
			</svg>
		);
	},
);
Sparkline.displayName = 'Sparkline';

export interface SparkBarProps extends React.SVGAttributes<SVGSVGElement> {
	/** Array of data points */
	data: number[];
	/** Width of the chart */
	width?: number;
	/** Height of the chart */
	height?: number;
	/** Bar color */
	color?: string;
	/** Gap between bars (as a ratio 0-1) */
	gap?: number;
	/** Minimum value (defaults to 0) */
	min?: number;
	/** Maximum value (defaults to max of data) */
	max?: number;
	/** Border radius of bars */
	radius?: number;
}

const SparkBar = React.forwardRef<SVGSVGElement, SparkBarProps>(
	(
		{
			className,
			data,
			width = 100,
			height = 32,
			color = 'currentColor',
			gap = 0.2,
			min: minProp = 0,
			max: maxProp,
			radius = 2,
			...props
		},
		ref,
	) => {
		if (data.length === 0) {
			return (
				<svg
					ref={ref}
					className={cn('text-accent', className)}
					width={width}
					height={height}
					viewBox={`0 0 ${width} ${height}`}
					{...props}
				/>
			);
		}

		const min = minProp;
		const max = maxProp ?? Math.max(...data);
		const range = max - min || 1;

		const barWidth = width / data.length;
		const gapWidth = barWidth * gap;
		const actualBarWidth = barWidth - gapWidth;

		return (
			<svg
				ref={ref}
				className={cn('text-accent', className)}
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				{...props}
			>
				{data.map((value, index) => {
					const barHeight = ((value - min) / range) * height;
					const x = index * barWidth + gapWidth / 2;
					const y = height - barHeight;

					return (
						<rect
							key={index}
							x={x}
							y={y}
							width={actualBarWidth}
							height={barHeight}
							fill={color}
							rx={radius}
							ry={radius}
						/>
					);
				})}
			</svg>
		);
	},
);
SparkBar.displayName = 'SparkBar';

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Card title */
	title: string;
	/** Main value to display */
	value: string | number;
	/** Optional description or subtext */
	description?: string;
	/** Sparkline data */
	sparklineData?: number[];
	/** Trend direction */
	trend?: 'up' | 'down' | 'neutral';
	/** Trend value (e.g., "+12%") */
	trendValue?: string;
	/** Icon to display */
	icon?: React.ReactNode;
}

const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
	(
		{
			className,
			title,
			value,
			description,
			sparklineData,
			trend,
			trendValue,
			icon,
			...props
		},
		ref,
	) => {
		const trendColor =
			trend === 'up'
				? 'text-green-500'
				: trend === 'down'
					? 'text-red-500'
					: 'text-muted-foreground';

		return (
			<div
				ref={ref}
				className={cn(
					'rounded-lg border border-border bg-surface p-4',
					className,
				)}
				{...props}
			>
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium text-muted-foreground">
						{title}
					</span>
					{icon && <span className="text-muted-foreground">{icon}</span>}
				</div>
				<div className="mt-2 flex items-end justify-between">
					<div>
						<div className="text-2xl font-bold text-foreground">{value}</div>
						{(description || trendValue) && (
							<div className="mt-1 flex items-center gap-1">
								{trendValue && (
									<span className={cn('text-xs font-medium', trendColor)}>
										{trendValue}
									</span>
								)}
								{description && (
									<span className="text-xs text-muted-foreground">
										{description}
									</span>
								)}
							</div>
						)}
					</div>
					{sparklineData && sparklineData.length > 0 && (
						<Sparkline
							data={sparklineData}
							width={80}
							height={32}
							filled
							className={
								trend === 'up'
									? 'text-green-500'
									: trend === 'down'
										? 'text-red-500'
										: 'text-accent'
							}
						/>
					)}
				</div>
			</div>
		);
	},
);
MetricCard.displayName = 'MetricCard';

export { Sparkline, SparkBar, MetricCard };
