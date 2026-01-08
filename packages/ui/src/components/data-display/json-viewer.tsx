'use client';

import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';

export interface JsonViewerProps extends React.HTMLAttributes<HTMLDivElement> {
	/** The JSON data to display */
	data: unknown;
	/** Whether to start expanded */
	defaultExpanded?: boolean;
	/** Maximum depth to expand by default */
	expandDepth?: number;
	/** Whether to show copy button */
	copyable?: boolean;
	/** Custom class for keys */
	keyClassName?: string;
	/** Custom class for values */
	valueClassName?: string;
}

const JsonViewer = React.forwardRef<HTMLDivElement, JsonViewerProps>(
	(
		{
			className,
			data,
			defaultExpanded = true,
			expandDepth = 2,
			copyable = true,
			keyClassName,
			valueClassName,
			...props
		},
		ref,
	) => {
		const [copied, setCopied] = React.useState(false);

		const handleCopy = async () => {
			await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		};

		return (
			<div
				ref={ref}
				className={cn(
					'relative rounded-md bg-surface border border-border font-mono text-sm',
					className,
				)}
				{...props}
			>
				{copyable && (
					<button
						type="button"
						onClick={handleCopy}
						className="absolute right-2 top-2 p-1.5 rounded-md hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
						aria-label="Copy JSON"
					>
						{copied ? (
							<Check className="h-4 w-4 text-green-500" />
						) : (
							<Copy className="h-4 w-4" />
						)}
					</button>
				)}
				<div className="p-3 overflow-auto">
					<JsonNode
						data={data}
						depth={0}
						defaultExpanded={defaultExpanded}
						expandDepth={expandDepth}
						keyClassName={keyClassName}
						valueClassName={valueClassName}
					/>
				</div>
			</div>
		);
	},
);
JsonViewer.displayName = 'JsonViewer';

interface JsonNodeProps {
	data: unknown;
	depth: number;
	defaultExpanded: boolean;
	expandDepth: number;
	keyClassName?: string;
	valueClassName?: string;
	propertyKey?: string;
	isLast?: boolean;
}

function JsonNode({
	data,
	depth,
	defaultExpanded,
	expandDepth,
	keyClassName,
	valueClassName,
	propertyKey,
	isLast = true,
}: JsonNodeProps) {
	const [expanded, setExpanded] = React.useState(
		defaultExpanded && depth < expandDepth,
	);

	const indent = depth * 16;

	// Null
	if (data === null) {
		return (
			<span className="inline">
				{propertyKey && (
					<>
						<span className={cn('text-purple-400', keyClassName)}>
							"{propertyKey}"
						</span>
						<span className="text-muted-foreground">: </span>
					</>
				)}
				<span className={cn('text-orange-400', valueClassName)}>null</span>
				{!isLast && <span className="text-muted-foreground">,</span>}
			</span>
		);
	}

	// Undefined
	if (data === undefined) {
		return (
			<span className="inline">
				{propertyKey && (
					<>
						<span className={cn('text-purple-400', keyClassName)}>
							"{propertyKey}"
						</span>
						<span className="text-muted-foreground">: </span>
					</>
				)}
				<span className={cn('text-gray-500', valueClassName)}>undefined</span>
				{!isLast && <span className="text-muted-foreground">,</span>}
			</span>
		);
	}

	// Boolean
	if (typeof data === 'boolean') {
		return (
			<span className="inline">
				{propertyKey && (
					<>
						<span className={cn('text-purple-400', keyClassName)}>
							"{propertyKey}"
						</span>
						<span className="text-muted-foreground">: </span>
					</>
				)}
				<span className={cn('text-blue-400', valueClassName)}>
					{String(data)}
				</span>
				{!isLast && <span className="text-muted-foreground">,</span>}
			</span>
		);
	}

	// Number
	if (typeof data === 'number') {
		return (
			<span className="inline">
				{propertyKey && (
					<>
						<span className={cn('text-purple-400', keyClassName)}>
							"{propertyKey}"
						</span>
						<span className="text-muted-foreground">: </span>
					</>
				)}
				<span className={cn('text-amber-400', valueClassName)}>{data}</span>
				{!isLast && <span className="text-muted-foreground">,</span>}
			</span>
		);
	}

	// String
	if (typeof data === 'string') {
		return (
			<span className="inline">
				{propertyKey && (
					<>
						<span className={cn('text-purple-400', keyClassName)}>
							"{propertyKey}"
						</span>
						<span className="text-muted-foreground">: </span>
					</>
				)}
				<span className={cn('text-green-400', valueClassName)}>"{data}"</span>
				{!isLast && <span className="text-muted-foreground">,</span>}
			</span>
		);
	}

	// Array
	if (Array.isArray(data)) {
		if (data.length === 0) {
			return (
				<span className="inline">
					{propertyKey && (
						<>
							<span className={cn('text-purple-400', keyClassName)}>
								"{propertyKey}"
							</span>
							<span className="text-muted-foreground">: </span>
						</>
					)}
					<span className="text-muted-foreground">[]</span>
					{!isLast && <span className="text-muted-foreground">,</span>}
				</span>
			);
		}

		return (
			<div className="inline-block">
				<span
					className="inline-flex items-center cursor-pointer hover:text-foreground text-muted-foreground"
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? (
						<ChevronDown className="h-3.5 w-3.5 mr-0.5" />
					) : (
						<ChevronRight className="h-3.5 w-3.5 mr-0.5" />
					)}
					{propertyKey && (
						<>
							<span className={cn('text-purple-400', keyClassName)}>
								"{propertyKey}"
							</span>
							<span className="text-muted-foreground">: </span>
						</>
					)}
					<span className="text-muted-foreground">[</span>
					{!expanded && (
						<>
							<span className="text-muted-foreground mx-1">
								{data.length} items
							</span>
							<span className="text-muted-foreground">]</span>
						</>
					)}
				</span>
				{expanded && (
					<>
						<div style={{ paddingLeft: indent + 16 }}>
							{data.map((item, index) => (
								<div key={index}>
									<JsonNode
										data={item}
										depth={depth + 1}
										defaultExpanded={defaultExpanded}
										expandDepth={expandDepth}
										keyClassName={keyClassName}
										valueClassName={valueClassName}
										isLast={index === data.length - 1}
									/>
								</div>
							))}
						</div>
						<span className="text-muted-foreground">]</span>
					</>
				)}
				{!isLast && <span className="text-muted-foreground">,</span>}
			</div>
		);
	}

	// Object
	if (typeof data === 'object') {
		const entries = Object.entries(data as Record<string, unknown>);

		if (entries.length === 0) {
			return (
				<span className="inline">
					{propertyKey && (
						<>
							<span className={cn('text-purple-400', keyClassName)}>
								"{propertyKey}"
							</span>
							<span className="text-muted-foreground">: </span>
						</>
					)}
					<span className="text-muted-foreground">{'{}'}</span>
					{!isLast && <span className="text-muted-foreground">,</span>}
				</span>
			);
		}

		return (
			<div className="inline-block">
				<span
					className="inline-flex items-center cursor-pointer hover:text-foreground text-muted-foreground"
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? (
						<ChevronDown className="h-3.5 w-3.5 mr-0.5" />
					) : (
						<ChevronRight className="h-3.5 w-3.5 mr-0.5" />
					)}
					{propertyKey && (
						<>
							<span className={cn('text-purple-400', keyClassName)}>
								"{propertyKey}"
							</span>
							<span className="text-muted-foreground">: </span>
						</>
					)}
					<span className="text-muted-foreground">{'{'}</span>
					{!expanded && (
						<>
							<span className="text-muted-foreground mx-1">...</span>
							<span className="text-muted-foreground">{'}'}</span>
						</>
					)}
				</span>
				{expanded && (
					<>
						<div style={{ paddingLeft: indent + 16 }}>
							{entries.map(([key, value], index) => (
								<div key={key}>
									<JsonNode
										data={value}
										depth={depth + 1}
										defaultExpanded={defaultExpanded}
										expandDepth={expandDepth}
										keyClassName={keyClassName}
										valueClassName={valueClassName}
										propertyKey={key}
										isLast={index === entries.length - 1}
									/>
								</div>
							))}
						</div>
						<span className="text-muted-foreground">{'}'}</span>
					</>
				)}
				{!isLast && <span className="text-muted-foreground">,</span>}
			</div>
		);
	}

	// Fallback
	return (
		<span className={cn('text-muted-foreground', valueClassName)}>
			{String(data)}
		</span>
	);
}

export { JsonViewer };
