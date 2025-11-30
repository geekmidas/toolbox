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

  async send(options: SendOptions): Promise<SendResult> {
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

  getTemplateNames(): TemplateNames<T>[] {
    return Object.keys(this.config.templates) as TemplateNames<T>[];
  }
}

export function createEmailClient<T extends TemplateRecord>(
  config: EmailClientConfig<T>,
): SMTPClient<T> {
  return new SMTPClient(config);
}
