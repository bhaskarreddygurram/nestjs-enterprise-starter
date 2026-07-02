import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../core/metrics/metrics.service';
import { AnthropicAiProvider } from './anthropic-ai.provider';
import { AI_PROVIDER, AiProvider } from './ai.interface';
import { NoopAiProvider } from './noop-ai.provider';
import { SecurityInsightsController } from './security-insights.controller';
import { SecurityInsightsService } from './security-insights.service';

/**
 * AI features (Phase 13). The concrete provider is chosen at runtime:
 *   AI_ENABLED=true + ANTHROPIC_API_KEY → Claude (AnthropicAiProvider)
 *   otherwise                           → NoopAiProvider (endpoints return 503)
 *
 * AuditRepository is injected (exported by the global AuditModule) so insights
 * are computed over the real audit trail; MetricsService (global) records AI
 * token usage and latency into the shared Prometheus registry.
 */
@Module({
  controllers: [SecurityInsightsController],
  providers: [
    SecurityInsightsService,
    {
      provide: AI_PROVIDER,
      inject: [ConfigService, MetricsService],
      useFactory: (
        config: ConfigService,
        metrics: MetricsService,
      ): AiProvider =>
        config.get<boolean>('ai.enabled')
          ? new AnthropicAiProvider(config, metrics)
          : new NoopAiProvider(),
    },
  ],
})
export class AiModule {}
