/** Single channel all audit events flow through. */
export const AUDIT_EVENT = 'audit.event';

/** Canonical action names recorded in the audit trail. */
export const AuditAction = {
  AUTH_LOGIN: 'auth.login',
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_LOGOUT_ALL: 'auth.logout_all',
  AUTH_TOKEN_REFRESHED: 'auth.token_refreshed',
  AUTH_ACCOUNT_LOCKED: 'auth.account_locked',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  AUTH_PASSWORD_RESET: 'auth.password_reset',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  AUTH_2FA_ENABLED: 'auth.2fa_enabled',
  AUTH_2FA_DISABLED: 'auth.2fa_disabled',
  AUTH_2FA_CHALLENGE: 'auth.2fa_challenge',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  ROLE_ASSIGNED: 'role.assigned',
  ROLE_REMOVED: 'role.removed',
  FILE_UPLOADED: 'file.uploaded',
  FILE_DELETED: 'file.deleted',
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',
  PROJECT_RESTORED: 'project.restored',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

/** Payload emitted on the AUDIT_EVENT channel and persisted by the listener. */
export interface AuditEvent {
  action: string;
  resource: string;
  resourceId?: string | null;
  /** Explicit actor; when omitted the emitter fills it from request context. */
  actorId?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}
