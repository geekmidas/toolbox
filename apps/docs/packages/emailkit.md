# @geekmidas/emailkit

Type-safe email sending with React template support.

## Installation

```bash
pnpm add @geekmidas/emailkit
```

## Features

- SMTP client with modern configuration
- React email template rendering
- Type-safe email composition
- Attachment support
- HTML and plain text variants

## Basic Usage

### Create Email Client

```typescript
import { EmailClient } from '@geekmidas/emailkit';

const email = new EmailClient({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'api@example.com',
    pass: 'password',
  },
});
```

### Send Simple Email

```typescript
await email.send({
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Welcome!',
  html: '<h1>Welcome to our platform!</h1>',
  text: 'Welcome to our platform!',
});
```

### Send with React Template

```typescript
import { WelcomeEmail } from './templates/WelcomeEmail';

await email.send({
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Welcome!',
  react: <WelcomeEmail name="John" confirmationUrl="https://..." />,
});
```

### React Email Template

```typescript
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

### Send with Attachments

```typescript
await email.send({
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Your Report',
  html: '<p>Please find your report attached.</p>',
  attachments: [
    {
      filename: 'report.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    },
  ],
});
```

## Template Factory

Create a type-safe email client with predefined templates:

```typescript
import { createEmailClient } from '@geekmidas/emailkit';
import { WelcomeEmail, PasswordResetEmail } from './templates';

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

// Type-safe template sending
await client.sendTemplate('welcome', {
  to: 'user@example.com',
  subject: 'Welcome!',
  props: {
    name: 'John',
    confirmationUrl: 'https://example.com/confirm/123',
  },
});
```
