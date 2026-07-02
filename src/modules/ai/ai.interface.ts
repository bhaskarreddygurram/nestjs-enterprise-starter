/** DI token for the active AI provider. */
export const AI_PROVIDER = 'AI_PROVIDER';

/**
 * A single audit event, flattened to the minimum the model needs to reason
 * about security posture. Deliberately excludes nothing sensitive that the
 * caller (an admin with `ai:read`) can't already see via the audit endpoint.
 */
export interface AuditEventSummary {
  action: string;
  actorId: string | null;
  resource: string;
  resourceId: string | null;
  ipAddress: string | null;
  createdAt: string;
  metadata?: unknown;
}

/** Severity buckets for an individual finding. */
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** Overall risk assessment for the analysed window. */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** One actionable observation the model surfaced. */
export interface SecurityFinding {
  title: string;
  severity: FindingSeverity;
  description: string;
  recommendation: string;
  /** Audit `action` values that support this finding, for traceability. */
  relatedActions: string[];
}

/** The model's structured verdict on a batch of audit events. */
export interface SecurityAnalysis {
  summary: string;
  riskLevel: RiskLevel;
  findings: SecurityFinding[];
}

/** Token accounting for one provider call (surfaced for cost observability). */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/** What a provider returns for a security-insights request. */
export interface SecurityAnalysisResult {
  analysis: SecurityAnalysis;
  model: string;
  usage: AiUsage;
}

/**
 * AI transport abstraction. Consumers depend only on this interface, so the
 * backend can be swapped (Anthropic → noop/other LLM) by binding a different
 * provider to AI_PROVIDER — the same pattern as MAIL_PROVIDER.
 */
export interface AiProvider {
  /** True when a real model is wired up; false for the noop provider. */
  readonly enabled: boolean;

  /** Analyse recent audit events and return a structured security verdict. */
  analyzeSecurityEvents(input: {
    events: AuditEventSummary[];
    windowHours: number;
  }): Promise<SecurityAnalysisResult>;
}
