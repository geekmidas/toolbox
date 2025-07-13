import nodemailer, { type Transporter } from 'nodemailer';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  EmailClient,
  EmailClientConfig,
  EmailTemplate,
  PlainEmailOptions,
  SendResult,
  TemplateEmailOptions,
  TemplateRegistry,
} from './types';

export class SMTPClient implements EmailClient {
  private transporter: Transporter;
  private config: EmailClientConfig;
  private templates: TemplateRegistry;

  constructor(config: EmailClientConfig) {
    this.config = config;
    this.transporter = nodemailer.createTransport(config.smtp as any);
    this.templates = new TemplateRegistryImpl();
  }

  async send(options: PlainEmailOptions): Promise<SendResult> {
    const mailOptions = {
      ...this.config.defaults,
      ...options,
    };

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

  async sendTemplate<T = any>(
    template: string,
    options: Omit<TemplateEmailOptions<T>, 'template'>,
  ): Promise<SendResult> {
    const templateFn = this.templates.get<T>(template);
    if (!templateFn) {
      throw new Error(`Template "${template}" not found`);
    }

    const element = templateFn(options.props);
    const html = renderToStaticMarkup(element);

    return this.send({
      ...options,
      html,
    });
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

  registerTemplate<T = any>(name: string, template: EmailTemplate<T>): void {
    this.templates.register(name, template);
  }

  getTemplateRegistry(): TemplateRegistry {
    return this.templates;
  }
}

class TemplateRegistryImpl implements TemplateRegistry {
  private templates = new Map<string, EmailTemplate>();

  register<T = any>(name: string, template: EmailTemplate<T>): void {
    this.templates.set(name, template);
  }

  get<T = any>(name: string): EmailTemplate<T> | undefined {
    return this.templates.get(name) as EmailTemplate<T> | undefined;
  }

  has(name: string): boolean {
    return this.templates.has(name);
  }

  list(): string[] {
    return Array.from(this.templates.keys());
  }
}

export function createEmailClient(config: EmailClientConfig): SMTPClient {
  return new SMTPClient(config);
}
