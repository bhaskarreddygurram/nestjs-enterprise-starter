import { ServiceUnavailableException } from '@nestjs/common';
import { AuditLog } from '@prisma/client';
import { AuditRepository } from '../audit/audit.repository';
import { AiProvider, SecurityAnalysisResult } from './ai.interface';
import { SecurityInsightsService } from './security-insights.service';

const auditRow = (over: Partial<AuditLog> = {}): AuditLog => ({
  id: 'a1',
  actorId: 'u1',
  action: 'auth.login.failed',
  resource: 'auth',
  resourceId: null,
  ipAddress: '10.0.0.1',
  requestId: 'req-1',
  metadata: null,
  createdAt: new Date('2026-07-02T10:00:00.000Z'),
  ...over,
});

const analysisResult: SecurityAnalysisResult = {
  model: 'claude-opus-4-8',
  usage: { inputTokens: 1000, outputTokens: 250 },
  analysis: {
    summary: 'Mostly routine, one burst of failed logins.',
    riskLevel: 'medium',
    findings: [
      {
        title: 'Failed logins',
        severity: 'medium',
        description: 'Burst for u1.',
        recommendation: 'Review.',
        relatedActions: ['auth.login.failed'],
      },
    ],
  },
};

function build(
  enabled: boolean,
  logs: AuditLog[],
): {
  service: SecurityInsightsService;
  repo: jest.Mocked<Pick<AuditRepository, 'findMany'>>;
  ai: jest.Mocked<AiProvider>;
} {
  const repo = {
    findMany: jest.fn().mockResolvedValue(logs),
  } as unknown as jest.Mocked<Pick<AuditRepository, 'findMany'>>;
  const ai = {
    enabled,
    analyzeSecurityEvents: jest.fn().mockResolvedValue(analysisResult),
  } as unknown as jest.Mocked<AiProvider>;
  const service = new SecurityInsightsService(
    repo as unknown as AuditRepository,
    ai,
  );
  return { service, repo, ai };
}

describe('SecurityInsightsService', () => {
  it('throws 503 when the AI provider is disabled', async () => {
    const { service, repo } = build(false, [auditRow()]);
    await expect(
      service.getInsights({ hours: 24, limit: 100 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.findMany).not.toHaveBeenCalled();
  });

  it('returns a model-free result (no token spend) when no events exist', async () => {
    const { service, ai } = build(true, []);
    const result = await service.getInsights({ hours: 12, limit: 50 });

    expect(result.analyzed).toBe(false);
    expect(result.eventCount).toBe(0);
    expect(result.riskLevel).toBe('low');
    expect(result.model).toBeNull();
    expect(result.usage).toBeNull();
    expect(ai.analyzeSecurityEvents).not.toHaveBeenCalled();
  });

  it('analyses events and maps the provider verdict into the response', async () => {
    const { service, repo, ai } = build(true, [
      auditRow(),
      auditRow({ id: 'a2', action: 'auth.account.locked' }),
    ]);

    const result = await service.getInsights({ hours: 24, limit: 100 });

    // window filter is applied
    expect(repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 100,
        where: { createdAt: { gte: expect.any(Date) as Date } },
      }),
    );
    // events are flattened to summaries (ISO string dates) before the AI call
    expect(ai.analyzeSecurityEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        windowHours: 24,
        events: expect.arrayContaining([
          expect.objectContaining({
            action: 'auth.login.failed',
            createdAt: '2026-07-02T10:00:00.000Z',
          }),
        ]) as unknown,
      }),
    );
    expect(result.analyzed).toBe(true);
    expect(result.eventCount).toBe(2);
    expect(result.riskLevel).toBe('medium');
    expect(result.model).toBe('claude-opus-4-8');
    expect(result.findings).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 250 });
  });
});
