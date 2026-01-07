import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailClient, SMTPClient } from '../client';
import type { EmailClientConfig, TemplateRecord } from '../types';

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(),
      verify: vi.fn(),
      close: vi.fn(),
    })),
  },
}));

// Mock @react-email/components
vi.mock('@react-email/components', () => ({
  render: vi.fn(),
}));

import { render } from '@react-email/components';
// Import mocked modules
import nodemailer from 'nodemailer';

// Test templates
interface WelcomeProps {
  name: string;
  verificationUrl: string;
}

interface ResetPasswordProps {
  resetUrl: string;
  expiresIn: number;
}

const WelcomeTemplate = (props: WelcomeProps): ReactElement =>
  ({ type: 'div', props: { children: `Welcome ${props.name}` } }) as any;

const ResetPasswordTemplate = (props: ResetPasswordProps): ReactElement =>
  ({ type: 'div', props: { children: `Reset: ${props.resetUrl}` } }) as any;

const templates = {
  welcome: WelcomeTemplate,
  resetPassword: ResetPasswordTemplate,
} satisfies TemplateRecord;

type TestTemplates = typeof templates;

describe('SMTPClient', () => {
  let mockTransporter: {
    sendMail: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let config: EmailClientConfig<TestTemplates>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTransporter = {
      sendMail: vi.fn().mockResolvedValue({
        messageId: 'test-message-id',
        accepted: ['recipient@example.com'],
        rejected: [],
        response: '250 OK',
      }),
      verify: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    };

    vi.mocked(nodemailer.createTransport).mockReturnValue(
      mockTransporter as any,
    );

    vi.mocked(render).mockResolvedValue('<html>Rendered HTML</html>');

    config = {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: {
          user: 'test@example.com',
          pass: 'password',
        },
      },
      templates,
      defaults: {
        from: 'noreply@example.com',
      },
    };
  });

  describe('constructor', () => {
    it('should create a transporter with SMTP config', () => {
      new SMTPClient(config);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(config.smtp);
    });
  });

  describe('send', () => {
    it('should send an email with required options', async () => {
      const client = new SMTPClient(config);

      const result = await client.send({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test content',
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: 'noreply@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test content',
      });

      expect(result).toEqual({
        messageId: 'test-message-id',
        accepted: ['recipient@example.com'],
        rejected: [],
        response: '250 OK',
      });
    });

    it('should send an email with HTML content', async () => {
      const client = new SMTPClient(config);

      await client.send({
        to: 'recipient@example.com',
        subject: 'HTML Email',
        html: '<h1>Hello</h1>',
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<h1>Hello</h1>',
        }),
      );
    });

    it('should override default from address', async () => {
      const client = new SMTPClient(config);

      await client.send({
        from: 'custom@example.com',
        to: 'recipient@example.com',
        subject: 'Custom From',
        text: 'Content',
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com',
        }),
      );
    });

    it('should throw error when from is not provided and no default', async () => {
      const configNoDefaults: EmailClientConfig<TestTemplates> = {
        ...config,
        defaults: {},
      };
      const client = new SMTPClient(configNoDefaults);

      await expect(
        client.send({
          to: 'recipient@example.com',
          subject: 'No From',
          text: 'Content',
        }),
      ).rejects.toThrow(
        'The "from" field is required in email options or defaults',
      );
    });

    it('should throw error when neither text nor html is provided', async () => {
      const client = new SMTPClient(config);

      await expect(
        client.send({
          to: 'recipient@example.com',
          subject: 'No Content',
        }),
      ).rejects.toThrow('Either text or html content must be provided');
    });

    it('should handle multiple recipients', async () => {
      const client = new SMTPClient(config);

      await client.send({
        to: ['user1@example.com', 'user2@example.com'],
        cc: 'cc@example.com',
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        subject: 'Multiple Recipients',
        text: 'Content',
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['user1@example.com', 'user2@example.com'],
          cc: 'cc@example.com',
          bcc: ['bcc1@example.com', 'bcc2@example.com'],
        }),
      );
    });

    it('should handle rejected recipients', async () => {
      mockTransporter.sendMail.mockResolvedValue({
        messageId: 'test-id',
        accepted: ['valid@example.com'],
        rejected: ['invalid@example.com'],
        response: '250 OK',
      });

      const client = new SMTPClient(config);

      const result = await client.send({
        to: ['valid@example.com', 'invalid@example.com'],
        subject: 'Test',
        text: 'Content',
      });

      expect(result.accepted).toEqual(['valid@example.com']);
      expect(result.rejected).toEqual(['invalid@example.com']);
    });

    it('should handle missing accepted/rejected in response', async () => {
      mockTransporter.sendMail.mockResolvedValue({
        messageId: 'test-id',
        response: '250 OK',
      });

      const client = new SMTPClient(config);

      const result = await client.send({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Content',
      });

      expect(result.accepted).toEqual([]);
      expect(result.rejected).toEqual([]);
    });
  });

  describe('sendTemplate', () => {
    it('should render and send a template', async () => {
      const client = new SMTPClient(config);

      const result = await client.sendTemplate('welcome', {
        to: 'user@example.com',
        subject: 'Welcome!',
        props: {
          name: 'John',
          verificationUrl: 'https://example.com/verify',
        },
      });

      expect(render).toHaveBeenCalled();
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Welcome!',
          html: '<html>Rendered HTML</html>',
        }),
      );
      expect(result.messageId).toBe('test-message-id');
    });

    it('should render resetPassword template', async () => {
      const client = new SMTPClient(config);

      await client.sendTemplate('resetPassword', {
        to: 'user@example.com',
        subject: 'Reset Your Password',
        props: {
          resetUrl: 'https://example.com/reset/abc123',
          expiresIn: 3600,
        },
      });

      expect(render).toHaveBeenCalled();
      expect(mockTransporter.sendMail).toHaveBeenCalled();
    });

    it('should throw error for unknown template', async () => {
      const client = new SMTPClient(config);

      await expect(
        client.sendTemplate('nonexistent' as any, {
          to: 'user@example.com',
          subject: 'Test',
          props: {},
        }),
      ).rejects.toThrow('Template "nonexistent" not found');
    });
  });

  describe('verify', () => {
    it('should return true when connection is valid', async () => {
      mockTransporter.verify.mockResolvedValue(true);
      const client = new SMTPClient(config);

      const result = await client.verify();

      expect(result).toBe(true);
      expect(mockTransporter.verify).toHaveBeenCalled();
    });

    it('should return false when connection fails', async () => {
      mockTransporter.verify.mockRejectedValue(new Error('Connection failed'));
      const client = new SMTPClient(config);

      const result = await client.verify();

      expect(result).toBe(false);
    });
  });

  describe('close', () => {
    it('should close the transporter', async () => {
      const client = new SMTPClient(config);

      await client.close();

      expect(mockTransporter.close).toHaveBeenCalled();
    });
  });

  describe('getTemplateNames', () => {
    it('should return all template names', () => {
      const client = new SMTPClient(config);

      const names = client.getTemplateNames();

      expect(names).toContain('welcome');
      expect(names).toContain('resetPassword');
      expect(names).toHaveLength(2);
    });
  });
});

describe('createEmailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: vi.fn(),
      verify: vi.fn(),
      close: vi.fn(),
    } as any);
  });

  it('should create an SMTPClient instance', () => {
    const config: EmailClientConfig<TestTemplates> = {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
      },
      templates,
      defaults: {
        from: 'test@example.com',
      },
    };

    const client = createEmailClient(config);

    expect(client).toBeInstanceOf(SMTPClient);
  });
});
