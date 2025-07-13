# @geekmidas/emailkit

Type-safe email client with SMTP support and React templates.

## Features

- **Type-Safe Templates**: Templates are provided at construction time with full TypeScript inference for both template names and their corresponding props
- **SMTP Support**: Works with any SMTP server via nodemailer configuration  
- **React Templates**: Uses `react-dom/server` to render React components to HTML

## Installation

```bash
pnpm add @geekmidas/emailkit
```

## Quick Start

```typescript
import { createEmailClient } from '@geekmidas/emailkit';

// Define your templates with props
const WelcomeEmail = ({ name, confirmationUrl }: { 
  name: string; 
  confirmationUrl?: string; 
}) => (
  <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: '600px' }}>
    <h1>Welcome, {name}!</h1>
    <p>We're excited to have you on board.</p>
    {confirmationUrl && (
      <p>
        <a href={confirmationUrl} style={{ 
          backgroundColor: '#007bff', 
          color: 'white', 
          padding: '10px 20px', 
          textDecoration: 'none',
          borderRadius: '4px' 
        }}>
          Confirm Email
        </a>
      </p>
    )}
  </div>
);

const templates = {
  welcome: WelcomeEmail,
};

// Create client with templates - types are fully inferred
const client = createEmailClient({
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    auth: {
      user: 'user@example.com',
      pass: 'password',
    },
  },
  templates,
  defaults: {
    from: 'noreply@example.com',
  },
});

// Send email with full type safety
await client.sendTemplate('welcome', {
  from: 'welcome@example.com',
  to: 'user@example.com',
  subject: 'Welcome to our service!',
  props: {
    name: 'John Doe',
    confirmationUrl: 'https://example.com/confirm/123',
  },
});
```

## API Reference

### `createEmailClient<T>(config: EmailClientConfig<T>): SMTPClient<T>`

Creates a new email client with type-safe template support.

#### Configuration

```typescript
interface EmailClientConfig<T extends TemplateRecord> {
  smtp: SMTPConfig;
  templates: T;
  defaults?: {
    from?: string | Address;
    replyTo?: string | Address;
  };
}

interface SMTPConfig {
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
```

### Client Methods

#### `send(options: PlainEmailOptions): Promise<SendResult>`

Send a plain text or HTML email.

```typescript
await client.send({
  from: 'info@example.com',
  to: 'user@example.com',
  subject: 'Plain email',
  text: 'This is a plain text email',
  html: '<p>This is an HTML email</p>',
});
```

#### `sendTemplate<K>(template: K, options): Promise<SendResult>`

Send an email using a React template with type-safe props.

```typescript
await client.sendTemplate('welcome', {
  from: 'welcome@example.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  props: { name: 'John', confirmationUrl: 'https://...' },
});
```

#### `verify(): Promise<boolean>`

Verify the SMTP connection.

#### `close(): Promise<void>`

Close the SMTP connection.

#### `getTemplateNames(): string[]`

Get available template names.

## Built-in Template Examples

### Welcome Email

```tsx
interface WelcomeEmailProps {
  name: string;
  confirmationUrl?: string;
}

const WelcomeEmail = ({ name, confirmationUrl }: WelcomeEmailProps) => (
  <html>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Welcome!</title>
    </head>
    <body style={{ margin: 0, padding: 0, backgroundColor: '#f4f4f4' }}>
      <div style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1.6,
        color: '#333',
        maxWidth: '600px',
        margin: '0 auto',
        padding: '20px',
      }}>
        <h1 style={{ color: '#2c3e50', marginBottom: '20px' }}>
          Welcome, {name}!
        </h1>
        <p>
          We're excited to have you on board. Your account has been successfully created.
        </p>
        {confirmationUrl && (
          <>
            <p>Please confirm your email address by clicking the button below:</p>
            <p style={{ textAlign: 'center', margin: '30px 0' }}>
              <a href={confirmationUrl} style={{
                display: 'inline-block',
                padding: '12px 24px',
                backgroundColor: '#3498db',
                color: '#ffffff',
                textDecoration: 'none',
                borderRadius: '4px',
                fontWeight: 'bold',
              }}>
                Confirm Email
              </a>
            </p>
          </>
        )}
        <div style={{
          marginTop: '40px',
          paddingTop: '20px',
          borderTop: '1px solid #eee',
          fontSize: '14px',
          color: '#666',
        }}>
          <p>If you have any questions, feel free to reply to this email.</p>
          <p>Best regards,<br />The Team</p>
        </div>
      </div>
    </body>
  </html>
);
```

### Password Reset Email

```tsx
interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
  expiresIn: string;
}

const PasswordResetEmail = ({ name, resetUrl, expiresIn }: PasswordResetEmailProps) => (
  <html>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Password Reset Request</title>
    </head>
    <body style={{ margin: 0, padding: 0, backgroundColor: '#f4f4f4' }}>
      <div style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1.6,
        color: '#333',
        maxWidth: '600px',
        margin: '0 auto',
        padding: '20px',
      }}>
        <h1 style={{ color: '#2c3e50', marginBottom: '20px' }}>
          Password Reset Request
        </h1>
        <p>Hi {name},</p>
        <p>
          We received a request to reset your password. Click the button below to create a new password:
        </p>
        <p style={{ textAlign: 'center', margin: '30px 0' }}>
          <a href={resetUrl} style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#3498db',
            color: '#ffffff',
            textDecoration: 'none',
            borderRadius: '4px',
            fontWeight: 'bold',
          }}>
            Reset Password
          </a>
        </p>
        <p>
          This link will expire in {expiresIn}. If you didn't request a password reset,
          you can safely ignore this email.
        </p>
        <div style={{
          marginTop: '40px',
          paddingTop: '20px',
          borderTop: '1px solid #eee',
          fontSize: '14px',
          color: '#666',
        }}>
          <p>For security reasons, this link can only be used once.</p>
        </div>
      </div>
    </body>
  </html>
);
```

### Notification Email

```tsx
interface NotificationEmailProps {
  name: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
}

const NotificationEmail = ({ 
  name, 
  title, 
  message, 
  actionUrl, 
  actionText = 'View Details' 
}: NotificationEmailProps) => (
  <html>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
    </head>
    <body style={{ margin: 0, padding: 0, backgroundColor: '#f4f4f4' }}>
      <div style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        lineHeight: 1.6,
        color: '#333',
        maxWidth: '600px',
        margin: '0 auto',
        padding: '20px',
      }}>
        <h1 style={{ color: '#2c3e50', marginBottom: '20px' }}>
          {title}
        </h1>
        <p>Hi {name},</p>
        <p>{message}</p>
        {actionUrl && (
          <p style={{ textAlign: 'center', margin: '30px 0' }}>
            <a href={actionUrl} style={{
              display: 'inline-block',
              padding: '12px 24px',
              backgroundColor: '#3498db',
              color: '#ffffff',
              textDecoration: 'none',
              borderRadius: '4px',
              fontWeight: 'bold',
            }}>
              {actionText}
            </a>
          </p>
        )}
        <div style={{
          marginTop: '40px',
          paddingTop: '20px',
          borderTop: '1px solid #eee',
          fontSize: '14px',
          color: '#666',
        }}>
          <p>This is an automated notification from our system.</p>
        </div>
      </div>
    </body>
  </html>
);
```

## Multiple Templates Example

```typescript
import { createEmailClient } from '@geekmidas/emailkit';

const templates = {
  welcome: WelcomeEmail,
  passwordReset: PasswordResetEmail,
  notification: NotificationEmail,
};

const client = createEmailClient({
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    auth: {
      user: 'user@example.com',
      pass: 'password',
    },
  },
  templates,
  defaults: {
    from: 'noreply@example.com',
  },
});

// All template names and props are fully type-safe
await client.sendTemplate('welcome', {
  from: 'welcome@example.com',
  to: 'user@example.com',
  subject: 'Welcome to our service!',
  props: { name: 'John Doe', confirmationUrl: 'https://example.com/confirm/123' },
});

await client.sendTemplate('passwordReset', {
  from: 'security@example.com',
  to: 'user@example.com',
  subject: 'Reset your password',
  props: { name: 'John Doe', resetUrl: 'https://example.com/reset/456', expiresIn: '24 hours' },
});

await client.sendTemplate('notification', {
  from: 'notifications@example.com',
  to: 'user@example.com',
  subject: 'Important notification',
  props: { 
    name: 'John Doe', 
    title: 'Account Update', 
    message: 'Your account settings have been updated.',
    actionUrl: 'https://example.com/settings',
    actionText: 'View Settings' 
  },
});
```

## TypeScript Support

The library provides full TypeScript support with:

- **Template name inference** - Only valid template names are accepted
- **Props type checking** - Props are validated based on the template's prop types
- **Autocomplete support** - IDE autocomplete for template names and props
- **Compile-time safety** - Catch template and prop errors at build time

## License

MIT