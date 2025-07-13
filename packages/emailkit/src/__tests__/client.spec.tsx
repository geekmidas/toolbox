// biome-ignore lint/correctness/noUnusedImports: <explanation>
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SMTPClient, createEmailClient } from '../client';
import type { EmailClientConfig } from '../types';

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({
        messageId: 'test-message-id',
        accepted: ['test@example.com'],
        rejected: [],
        response: '250 OK',
      }),
      verify: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    })),
  },
}));

const TestTemplate = ({ name }: { name: string }) => <div>Hello {name}!</div>;

const AnotherTemplate = ({
  title,
  message,
}: { title: string; message: string }) => (
  <div>
    <h1>{title}</h1>
    <p>{message}</p>
  </div>
);

describe('SMTPClient', () => {
  let client: SMTPClient<typeof templates>;

  const templates = {
    test: TestTemplate,
    another: AnotherTemplate,
  };

  const config: EmailClientConfig<typeof templates> = {
    smtp: {
      host: 'smtp.example.com',
      port: 587,
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

  beforeEach(() => {
    client = createEmailClient(config);
  });

  describe('send', () => {
    it('should send plain text email', async () => {
      const result = await client.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'This is a test email',
      });

      expect(result).toEqual({
        messageId: 'test-message-id',
        accepted: ['test@example.com'],
        rejected: [],
        response: '250 OK',
      });
    });

    it('should send HTML email', async () => {
      const result = await client.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email',
        html: '<p>This is a test email</p>',
      });

      expect(result.messageId).toBe('test-message-id');
    });

    it('should use default from address', async () => {
      const result = await client.send({
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'This is a test email',
        from: {
          name: 'Test Sender',
          address: 'sender@example.com',
        },
      });

      expect(result.messageId).toBe('test-message-id');
    });

    it('should throw error if no content provided', async () => {
      await expect(
        client.send({
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Test Email',
        }),
      ).rejects.toThrow('Either text or html content must be provided');
    });

    it('should support multiple recipients', async () => {
      const result = await client.send({
        from: 'sender@example.com',
        to: ['recipient1@example.com', 'recipient2@example.com'],
        subject: 'Test Email',
        text: 'This is a test email',
      });

      expect(result.messageId).toBe('test-message-id');
    });

    it('should support CC and BCC', async () => {
      const result = await client.send({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        cc: 'cc@example.com',
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        subject: 'Test Email',
        text: 'This is a test email',
      });

      expect(result.messageId).toBe('test-message-id');
    });
  });

  describe('sendTemplate', () => {
    it('should send email with React template', async () => {
      const result = await client.sendTemplate('test', {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Template Email',
        props: { name: 'John' },
      });

      expect(result.messageId).toBe('test-message-id');
    });

    it('should send email with another template', async () => {
      const result = await client.sendTemplate('another', {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Another Template Email',
        props: { title: 'Hello', message: 'World' },
      });

      expect(result.messageId).toBe('test-message-id');
    });
  });

  describe('verify', () => {
    it('should verify SMTP connection', async () => {
      const result = await client.verify();
      expect(result).toBe(true);
    });
  });

  describe('close', () => {
    it('should close SMTP connection', async () => {
      await expect(client.close()).resolves.not.toThrow();
    });
  });

  describe('template names', () => {
    it('should return available template names', () => {
      const templateNames = client.getTemplateNames();
      expect(templateNames).toEqual(['test', 'another']);
    });
  });
});
