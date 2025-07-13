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

export interface TemplateEmailOptions<T = any> extends EmailOptions {
  template: string;
  props: T;
}

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

export interface EmailClientConfig {
  smtp: SMTPConfig;
  defaults?: {
    from?: string | Address;
    replyTo?: string | Address;
  };
  templates?: {
    directory?: string;
    extension?: string;
  };
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
}

export interface EmailTemplate<T = any> {
  (props: T): ReactElement;
}

export interface EmailClient {
  send(options: PlainEmailOptions): Promise<SendResult>;
  sendTemplate<T = any>(
    template: string,
    options: Omit<TemplateEmailOptions<T>, 'template'>,
  ): Promise<SendResult>;
  verify(): Promise<boolean>;
  close(): Promise<void>;
}

export interface TemplateRegistry {
  register<T = any>(name: string, template: EmailTemplate<T>): void;
  get<T = any>(name: string): EmailTemplate<T> | undefined;
  has(name: string): boolean;
  list(): string[];
}
