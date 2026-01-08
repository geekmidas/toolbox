import type { ExceptionEntry } from '../types';

interface ExceptionDetailProps {
	exception: ExceptionEntry;
	onClose: () => void;
}

export function ExceptionDetail({ exception, onClose }: ExceptionDetailProps) {
	return (
		<div className="fixed top-0 right-0 bottom-0 w-1/2 max-w-3xl bg-bg-secondary border-l border-border flex flex-col z-50 shadow-2xl">
			<div className="flex items-center justify-between p-4 border-b border-border">
				<h2 className="text-base font-semibold text-red-400">
					{exception.name}
				</h2>
				<button
					className="text-slate-400 hover:text-slate-100 p-2 text-xl leading-none"
					onClick={onClose}
				>
					&times;
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-4">
				<section className="mb-6">
					<h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
						Overview
					</h3>
					<div className="space-y-2 text-sm">
						<div className="flex py-2 border-b border-border">
							<span className="text-slate-500 min-w-32">Message</span>
							<span className="wrap-break-word">{exception.message}</span>
						</div>
						<div className="flex py-2 border-b border-border">
							<span className="text-slate-500 min-w-32">Handled</span>
							<span>{exception.handled ? 'Yes' : 'No'}</span>
						</div>
						<div className="flex py-2 border-b border-border">
							<span className="text-slate-500 min-w-32">Timestamp</span>
							<span>{new Date(exception.timestamp).toLocaleString()}</span>
						</div>
						{exception.requestId && (
							<div className="flex py-2 border-b border-border">
								<span className="text-slate-500 min-w-32">Request ID</span>
								<span className="font-mono text-xs">{exception.requestId}</span>
							</div>
						)}
						{exception.tags && exception.tags.length > 0 && (
							<div className="flex py-2">
								<span className="text-slate-500 min-w-32">Tags</span>
								<span>{exception.tags.join(', ')}</span>
							</div>
						)}
					</div>
				</section>

				{exception.source && (
					<section className="mb-6">
						<h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
							Source
						</h3>
						<div className="text-sm mb-2">
							<span className="text-slate-500">File: </span>
							<span>
								{exception.source.file}
								{exception.source.line && `:${exception.source.line}`}
							</span>
						</div>
						{exception.source.code && (
							<pre className="bg-bg-primary border border-border rounded-lg p-4 overflow-x-auto text-xs leading-relaxed">
								{exception.source.code}
							</pre>
						)}
					</section>
				)}

				<section className="mb-6">
					<h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
						Stack Trace
					</h3>
					<div className="text-xs leading-relaxed space-y-1">
						{exception.stack.map((frame, index) => (
							<div key={index} className="text-slate-400">
								<span className="text-blue-400">
									{frame.function || '<anonymous>'}
								</span>
								{frame.file && (
									<span className="text-slate-500 ml-2">
										at {frame.file}
										{frame.line !== undefined && `:${frame.line}`}
										{frame.column !== undefined && `:${frame.column}`}
									</span>
								)}
							</div>
						))}
					</div>
				</section>
			</div>
		</div>
	);
}
