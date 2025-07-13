import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SMTPClient, createEmailClient } from './client';
import type { EmailClientConfig } from './types';

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

describe('SMTPClient', () => {
  let client: SMTPClient;
  const config: EmailClientConfig = {
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      auth: {
        user: 'test@example.com',
        pass: 'password',
      },
    },
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
      const TestTemplate = ({ name }: { name: string }) =>
        React.createElement('div', null, `Hello ${name}!`);

      client.registerTemplate('test', TestTemplate);

      const result = await client.sendTemplate('test', {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Template Email',
        props: { name: 'John' },
      });

      expect(result.messageId).toBe('test-message-id');
    });

    it('should throw error for unknown template', async () => {
      await expect(
        client.sendTemplate('unknown', {
          from: 'sender@example.com',
          to: 'recipient@example.com',
          subject: 'Test Email',
          props: {},
        }),
      ).rejects.toThrow('Template "unknown" not found');
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

  describe('template registry', () => {
    it('should register and list templates', () => {
      const Template1 = () => React.createElement('div', null, 'Template 1');
      const Template2 = () => React.createElement('div', null, 'Template 2');

      client.registerTemplate('template1', Template1);
      client.registerTemplate('template2', Template2);

      const registry = client.getTemplateRegistry();
      expect(registry.has('template1')).toBe(true);
      expect(registry.has('template2')).toBe(true);
      expect(registry.list()).toEqual(['template1', 'template2']);
    });

    it('should get registered template', () => {
      const TestTemplate = () => React.createElement('div', null, 'Test');
      client.registerTemplate('test', TestTemplate);

      const registry = client.getTemplateRegistry();
      const template = registry.get('test');
      expect(template).toBe(TestTemplate);
    });
  });
});
