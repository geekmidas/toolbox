export { createEmailClient, SMTPClient } from './client';
export {
	EmailUrlError,
	MalformedEmailUrl,
	UnsupportedEmailScheme,
} from './errors';
export type {
	Attachment,
	EmailClient,
	EmailClientConfig,
	EmailOptions,
	EmailTemplate,
	PlainEmailOptions,
	SendOptions,
	SendResult,
	SMTPConfig,
	TemplateNames,
	TemplatePropsFor,
	TemplateRecord,
} from './types';
export { parseEmailUrl } from './url';
