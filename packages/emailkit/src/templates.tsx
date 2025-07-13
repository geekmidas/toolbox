import type React from 'react';
import type { CSSProperties, ReactElement } from 'react';

// Common email styling utilities
export const emailStyles = {
  container: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    lineHeight: 1.6,
    color: '#333',
    maxWidth: '600px',
    margin: '0 auto',
    padding: '20px',
  } as CSSProperties,

  heading: {
    color: '#2c3e50',
    marginBottom: '20px',
  } as CSSProperties,

  button: {
    display: 'inline-block',
    padding: '12px 24px',
    backgroundColor: '#3498db',
    color: '#ffffff',
    textDecoration: 'none',
    borderRadius: '4px',
    fontWeight: 'bold',
  } as CSSProperties,

  footer: {
    marginTop: '40px',
    paddingTop: '20px',
    borderTop: '1px solid #eee',
    fontSize: '14px',
    color: '#666',
  } as CSSProperties,
};

// Base layout component for emails
export interface EmailLayoutProps {
  children: React.ReactNode;
  preheader?: string;
  title?: string;
}

export function EmailLayout({
  children,
  preheader,
  title,
}: EmailLayoutProps): ReactElement {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {title && <title>{title}</title>}
        {preheader && (
          <div style={{ display: 'none', maxHeight: 0, overflow: 'hidden' }}>
            {preheader}
          </div>
        )}
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: '#f4f4f4' }}>
        <div style={emailStyles.container}>{children}</div>
      </body>
    </html>
  );
}

// Example welcome email template
export interface WelcomeEmailProps {
  name: string;
  confirmationUrl?: string;
}

export function WelcomeEmail({
  name,
  confirmationUrl,
}: WelcomeEmailProps): ReactElement {
  return (
    <EmailLayout
      title="Welcome!"
      preheader={`Welcome to our service, ${name}!`}
    >
      <h1 style={emailStyles.heading}>Welcome, {name}!</h1>
      <p>
        We're excited to have you on board. Your account has been successfully
        created.
      </p>
      {confirmationUrl && (
        <>
          <p>Please confirm your email address by clicking the button below:</p>
          <p style={{ textAlign: 'center', margin: '30px 0' }}>
            <a href={confirmationUrl} style={emailStyles.button}>
              Confirm Email
            </a>
          </p>
        </>
      )}
      <div style={emailStyles.footer}>
        <p>If you have any questions, feel free to reply to this email.</p>
        <p>
          Best regards,
          <br />
          The Team
        </p>
      </div>
    </EmailLayout>
  );
}

// Example password reset template
export interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
  expiresIn: string;
}

export function PasswordResetEmail({
  name,
  resetUrl,
  expiresIn,
}: PasswordResetEmailProps): ReactElement {
  return (
    <EmailLayout title="Password Reset Request" preheader="Reset your password">
      <h1 style={emailStyles.heading}>Password Reset Request</h1>
      <p>Hi {name},</p>
      <p>
        We received a request to reset your password. Click the button below to
        create a new password:
      </p>
      <p style={{ textAlign: 'center', margin: '30px 0' }}>
        <a href={resetUrl} style={emailStyles.button}>
          Reset Password
        </a>
      </p>
      <p>
        This link will expire in {expiresIn}. If you didn't request a password
        reset, you can safely ignore this email.
      </p>
      <div style={emailStyles.footer}>
        <p>For security reasons, this link can only be used once.</p>
      </div>
    </EmailLayout>
  );
}

// Example notification template
export interface NotificationEmailProps {
  name: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
}

export function NotificationEmail({
  name,
  title,
  message,
  actionUrl,
  actionText = 'View Details',
}: NotificationEmailProps): ReactElement {
  return (
    <EmailLayout title={title} preheader={message}>
      <h1 style={emailStyles.heading}>{title}</h1>
      <p>Hi {name},</p>
      <p>{message}</p>
      {actionUrl && (
        <p style={{ textAlign: 'center', margin: '30px 0' }}>
          <a href={actionUrl} style={emailStyles.button}>
            {actionText}
          </a>
        </p>
      )}
      <div style={emailStyles.footer}>
        <p>This is an automated notification from our system.</p>
      </div>
    </EmailLayout>
  );
}
