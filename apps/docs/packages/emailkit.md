# @geekmidas/emailkit

Type-safe email sending with React template support.

## Installation

```bash
pnpm add @geekmidas/emailkit
```

**Peer dependencies:**

```bash
pnpm add react react-dom @react-email/components
```

## Features

- Type-safe template names and props inference
- React email template rendering via `@react-email/components`
- SMTP client with connection pooling and rate limiting
- Plain text and HTML email sending
- Multiple recipients (to, cc, bcc)
- Attachment support
- DKIM signing
- Default sender configuration
- Connection verification

## Basic Usage

### Create Email Client

Use `createEmailClient` with your SMTP config, templates, and defaults:

```typescript
import { createEmailClient } from '@geekmidas/emailkit';
import { WelcomeEmail } from './templates/WelcomeEmail';
import { PasswordResetEmail } from './templates/PasswordResetEmail';

const templates = {
  welcome: WelcomeEmail,
  passwordReset: PasswordResetEmail,
};

const client = createEmailClient({
  smtp: {
    host: process.env.SMTP_HOST!,
    port: 587,
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  },
  templates,
  defaults: {
    from: 'noreply@example.com',
  },
});
```

You can also use the `SMTPClient` class directly:

```typescript
import { SMTPClient } from '@geekmidas/emailkit';

const client = new SMTPClient({
  smtp: { host: 'smtp.example.com', port: 587 },
  templates: {},
  defaults: { from: 'noreply@example.com' },
});
```

### Send with React Template

Use `sendTemplate()` for type-safe template rendering. The template name and props are fully inferred from the templates record:

```typescript
await client.sendTemplate('welcome', {
  to: 'user@example.com',
  subject: 'Welcome!',
  props: {
    name: 'John',
    confirmationUrl: 'https://example.com/confirm/123',
  },
});
```

### Send Plain Email

Use `send()` for plain text or HTML emails without templates:

```typescript
await client.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Welcome to our platform!</h1>',
  text: 'Welcome to our platform!',
});
```

::: tip
The `from` field is optional on both `send()` and `sendTemplate()` when `defaults.from` is configured. If neither is provided, an error is thrown.
:::

### Send with Attachments

```typescript
await client.send({
  to: 'user@example.com',
  subject: 'Your Report',
  html: '<p>Please find your report attached.</p>',
  attachments: [
    {
      filename: 'report.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    },
    {
      filename: 'logo.png',
      path: '/path/to/logo.png',
      cid: 'logo', // for inline embedding via <img src="cid:logo">
    },
  ],
});
```

### Multiple Recipients

```typescript
await client.send({
  to: ['alice@example.com', 'bob@example.com'],
  cc: ['manager@example.com'],
  bcc: ['audit@example.com'],
  subject: 'Team Update',
  text: 'Here is the latest update.',
});

// Named addresses
await client.send({
  to: [{ name: 'Alice', address: 'alice@example.com' }],
  replyTo: { name: 'Support', address: 'support@example.com' },
  subject: 'Hello',
  text: 'Hi Alice!',
});
```

## React Email Templates

Define templates as React components using `@react-email/components`:

```tsx
// templates/WelcomeEmail.tsx
import * as React from 'react';
import { Html, Head, Body, Container, Text, Button } from '@react-email/components';

interface WelcomeEmailProps {
  name: string;
  confirmationUrl: string;
}

export function WelcomeEmail({ name, confirmationUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Body>
        <Container>
          <Text>Hi {name},</Text>
          <Text>Welcome to our platform! Please confirm your email:</Text>
          <Button href={confirmationUrl}>Confirm Email</Button>
        </Container>
      </Body>
    </Html>
  );
}
```

Templates are rendered to HTML via `@react-email/components`'s `render()` function before sending.

## Advanced Configuration

### DKIM Signing

```typescript
const client = createEmailClient({
  smtp: { host: 'smtp.example.com', port: 587 },
  templates,
  defaults: { from: 'noreply@example.com' },
  dkim: {
    domainName: 'example.com',
    keySelector: 'mail',
    privateKey: process.env.DKIM_PRIVATE_KEY!,
  },
});
```

### Connection Pooling

Enable connection pooling for high-throughput sending:

```typescript
const client = createEmailClient({
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    auth: { user: 'api@example.com', pass: 'password' },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateLimit: 10, // messages per second
  },
  templates,
  defaults: { from: 'noreply@example.com' },
});
```

### Connection Verification

Verify the SMTP connection is working:

```typescript
const isConnected = await client.verify();
if (!isConnected) {
  console.error('SMTP connection failed');
}
```

### Cleanup

Close the transporter when shutting down:

```typescript
await client.close();
```

## API Reference

### `createEmailClient(config)`

Factory function that returns an `SMTPClient` instance.

### `SMTPClient<T>` Methods

| Method | Return | Description |
|--------|--------|-------------|
| `send(options)` | `Promise<SendResult>` | Send a plain text or HTML email |
| `sendTemplate(name, options)` | `Promise<SendResult>` | Send an email using a registered React template |
| `verify()` | `Promise<boolean>` | Test the SMTP connection |
| `close()` | `Promise<void>` | Close the SMTP transporter |
| `getTemplateNames()` | `string[]` | List all registered template names |

### `SendResult`

```typescript
interface SendResult {
  messageId: string;    // Message ID from SMTP server
  accepted: string[];   // Recipients that accepted the message
  rejected: string[];   // Recipients that rejected the message
  response: string;     // Raw SMTP response
}
```

### `SMTPConfig`

```typescript
interface SMTPConfig {
  host: string;
  port: number;
  secure?: boolean;            // Use TLS (default: false)
  auth?: { user: string; pass: string };
  tls?: {
    rejectUnauthorized?: boolean;
    servername?: string;
  };
  pool?: boolean;              // Enable connection pooling
  maxConnections?: number;     // Max simultaneous connections
  maxMessages?: number;        // Max messages per connection
  rateLimit?: number;          // Messages per second
  logger?: boolean;            // Enable nodemailer logging
  debug?: boolean;             // Enable debug output
}
```
