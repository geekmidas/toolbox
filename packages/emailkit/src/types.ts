import type { Address } from 'nodemailer/lib/mailer';
import type { ReactElement } from 'react';

export interface EmailOptions {
	from: string | Address;
	to: string | string[] | Address[];
	cc?: string | string[] | Address[];
	bcc?: string | string[] | Address[];
	subject: string;
	replyTo?: string | Address;
	attachments?: Attachment[];
}

export interface Attachment {
	filename: string;
	content?: string | Buffer;
	path?: string;
	contentType?: string;
	cid?: string;
}

export interface PlainEmailOptions extends EmailOptions {
	text?: string;
	html?: string;
}

export type SendOptions = Omit<PlainEmailOptions, 'from'> & {
	from?: string | Address;
};

export interface SMTPConfig {
	host: string;
	port: number;
	secure?: boolean;
	auth?: {
		user: string;
		pass: string;
	};
	tls?: {
		rejectUnauthorized?: boolean;
		servername?: string;
	};
	pool?: boolean;
	maxConnections?: number;
	maxMessages?: number;
	rateLimit?: number;
	logger?: boolean;
	debug?: boolean;
}

export interface SendResult {
	messageId: string;
	accepted: string[];
	rejected: string[];
	response: string;
}

export type EmailTemplate<T = any> = (props: T) => ReactElement;

// Extract props type from a template function
export type TemplateProps<T> = T extends EmailTemplate<infer P> ? P : never;

// Template record type for type safety
export type TemplateRecord = Record<string, EmailTemplate<any>>;

// Extract template names from template record
export type TemplateNames<T extends TemplateRecord> = keyof T;

// Extract props for a specific template
export type TemplatePropsFor<
	T extends TemplateRecord,
	K extends TemplateNames<T>,
> = TemplateProps<T[K]>;

export interface EmailClientConfig<T extends TemplateRecord = TemplateRecord> {
	smtp: SMTPConfig;
	templates: T;
	dkim?: {
		domainName: string;
		keySelector: string;
		privateKey: string;
	};
	defaults: {
		from?: string | Address;
		replyTo?: string | Address;
	};
}

export interface EmailClient<T extends TemplateRecord = TemplateRecord> {
	send(options: SendOptions): Promise<SendResult>;
	sendTemplate<K extends TemplateNames<T>>(
		template: K,
		options: SendOptions & {
			props: TemplatePropsFor<T, K>;
		},
	): Promise<SendResult>;
	verify(): Promise<boolean>;
	close(): Promise<void>;
}
