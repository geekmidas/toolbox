import type { AuditableAction, AuditStorage } from '@geekmidas/audit';
import { InMemoryAuditStorage } from '@geekmidas/audit/memory';
import type { Service } from '@geekmidas/services';

/**
 * Audit actions — typing these gives `.audit([...])` / `auditor.audit(...)` full
 * inference on endpoints. Swap `InMemoryAuditStorage` for `KyselyAuditStorage`
 * to persist.
 */
export type AppAuditAction =
	| AuditableAction<'user.created', { userId: string; email: string }>
	| AuditableAction<'user.viewed', { userId: string }>;

let instance: AuditStorage<AppAuditAction> | null = null;

export const AuditStorageService = {
	serviceName: 'auditStorage' as const,
	async register(): Promise<AuditStorage<AppAuditAction>> {
		if (!instance) {
			instance = new InMemoryAuditStorage<AppAuditAction>();
		}
		return instance;
	},
} satisfies Service<'auditStorage', AuditStorage<AppAuditAction>>;
