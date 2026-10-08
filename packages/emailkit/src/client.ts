import {
	type Attributes,
	SpanKind,
	SpanStatusCode,
	trace,
} from '@opentelemetry/api';
import { render } from '@react-email/components';
import nodemailer, { type Transporter } from 'nodemailer';
import type {
	EmailClient,
	EmailClientConfig,
	SendOptions,
	SendResult,
	TemplateNames,
	TemplatePropsFor,
	TemplateRecord,
} from './types';

export class SMTPClient<T extends TemplateRecord> implements EmailClient<T> {
	private transporter: Transporter;
	private config: EmailClientConfig<T>;

	constructor(config: EmailClientConfig<T>) {
		this.config = config;
		this.transporter = nodemailer.createTransport(config.smtp as any);
	}

	/**
	 * Send one message. An `email.send` span covers it, through the global
	 * OpenTelemetry tracer: the transport and how many were accepted or
	 * rejected, never an address, subject or body.
	 */
	async send(options: SendOptions): Promise<SendResult> {
		return traceSend({ 'email.recipients': recipients(options) }, () =>
			this.deliver(options),
		);
	}

	private async deliver(options: SendOptions): Promise<SendResult> {
		const mailOptions = {
			...this.config.defaults,
			...options,
		};

		if (!mailOptions.from) {
			throw new Error(
				'The "from" field is required in email options or defaults',
			);
		}

		if (!mailOptions.text && !mailOptions.html) {
			throw new Error('Either text or html content must be provided');
		}

		const info = await this.transporter.sendMail(mailOptions);

		return {
			messageId: info.messageId,
			accepted: info.accepted || [],
			rejected: info.rejected || [],
			response: info.response,
		};
	}

	async sendTemplate<K extends TemplateNames<T>>(
		template: K,
		options: Omit<SendOptions, 'template'> & {
			props: TemplatePropsFor<T, K>;
		},
	): Promise<SendResult> {
		const Component = this.config.templates[template];
		if (!Component) {
			throw new Error(`Template "${String(template)}" not found`);
		}

		const element = Component(options.props);
		const html = await render(element);

		return traceSend(
			{
				'email.template': String(template),
				'email.recipients': recipients(options),
			},
			() => this.deliver({ ...options, html }),
		);
	}

	async verify(): Promise<boolean> {
		try {
			await this.transporter.verify();
			return true;
		} catch {
			return false;
		}
	}

	async close(): Promise<void> {
		this.transporter.close();
	}

	getTemplateNames(): TemplateNames<T>[] {
		return Object.keys(this.config.templates) as TemplateNames<T>[];
	}
}

export function createEmailClient<T extends TemplateRecord>(
	config: EmailClientConfig<T>,
): SMTPClient<T> {
	return new SMTPClient(config);
}

/** How many addresses a message is for: to, cc and bcc. */
function recipients(options: {
	to?: unknown;
	cc?: unknown;
	bcc?: unknown;
}): number {
	return count(options.to) + count(options.cc) + count(options.bcc);
}

function count(value: unknown): number {
	if (!value) return 0;
	return Array.isArray(value) ? value.length : 1;
}

async function traceSend(
	attributes: Attributes,
	send: () => Promise<SendResult>,
): Promise<SendResult> {
	const span = trace.getTracer('@geekmidas/emailkit').startSpan('email.send', {
		kind: SpanKind.CLIENT,
		attributes: { 'email.transport': 'smtp', ...attributes },
	});
	try {
		const result = await send();
		// What the server said, when the transport reports it.
		if (result.accepted.length || result.rejected.length) {
			span.setAttributes({
				'email.accepted': count(result.accepted),
				'email.rejected': count(result.rejected),
			});
		}
		return result;
	} catch (error) {
		if (error instanceof Error) span.recordException(error);
		span.setStatus({ code: SpanStatusCode.ERROR });
		throw error;
	} finally {
		span.end();
	}
}
