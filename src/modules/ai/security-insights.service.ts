import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { AuditRepository } from '../audit/audit.repository';
import { AI_PROVIDER, AiProvider, AuditEventSummary } from './ai.interface';
import { SecurityInsightsQueryDto } from './dto/security-insights-query.dto';
import { SecurityInsightsResponseDto } from './dto/security-insights-response.dto';

/**
 * Orchestrates AI security insights: pulls a bounded, recent slice of the audit
 * trail, hands it to the configured AI provider, and returns a structured
 * verdict. The audit data never leaves the provider abstraction, so swapping
 * the model (or disabling AI) needs no change here.
 */
@Injectable()
export class SecurityInsightsService {
  private readonly logger = new Logger(SecurityInsightsService.name);

  constructor(
    private readonly auditRepository: AuditRepository,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  async getInsights(
    query: SecurityInsightsQueryDto,
  ): Promise<SecurityInsightsResponseDto> {
    if (!this.ai.enabled) {
      throw new ServiceUnavailableException(
        'AI features are disabled. Set AI_ENABLED=true and ANTHROPIC_API_KEY to enable them.',
      );
    }

    const since = new Date(Date.now() - query.hours * 60 * 60 * 1000);
    const where: Prisma.AuditLogWhereInput = { createdAt: { gte: since } };
    const logs = await this.auditRepository.findMany({
      skip: 0,
      take: query.limit,
      where,
    });

    const generatedAt = new Date().toISOString();

    // Nothing to analyse — return a clean, model-free result (no token spend).
    if (logs.length === 0) {
      return {
        analyzed: false,
        generatedAt,
        windowHours: query.hours,
        eventCount: 0,
        model: null,
        riskLevel: 'low',
        summary: `No audit events in the last ${query.hours} hour(s).`,
        findings: [],
        usage: null,
      };
    }

    const events = logs.map((log) => this.toSummary(log));
    const result = await this.ai.analyzeSecurityEvents({
      events,
      windowHours: query.hours,
    });

    this.logger.log(
      `Security insights generated over ${events.length} event(s): risk=${result.analysis.riskLevel}, findings=${result.analysis.findings.length}`,
    );

    return {
      analyzed: true,
      generatedAt,
      windowHours: query.hours,
      eventCount: events.length,
      model: result.model,
      riskLevel: result.analysis.riskLevel,
      summary: result.analysis.summary,
      findings: result.analysis.findings,
      usage: result.usage,
    };
  }

  private toSummary(log: AuditLog): AuditEventSummary {
    return {
      action: log.action,
      actorId: log.actorId,
      resource: log.resource,
      resourceId: log.resourceId,
      ipAddress: log.ipAddress,
      createdAt: log.createdAt.toISOString(),
      metadata: log.metadata ?? undefined,
    };
  }
}
