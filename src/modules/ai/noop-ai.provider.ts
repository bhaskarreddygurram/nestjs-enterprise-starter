import { ServiceUnavailableException } from '@nestjs/common';
import { AiProvider, SecurityAnalysisResult } from './ai.interface';

/**
 * Fallback provider used when AI is disabled or no API key is configured.
 * Reports `enabled: false` so callers can advertise the feature's state, and
 * fails closed with a clear 503 if an analysis is nonetheless requested.
 */
export class NoopAiProvider implements AiProvider {
  readonly enabled = false;

  analyzeSecurityEvents(): Promise<SecurityAnalysisResult> {
    throw new ServiceUnavailableException(
      'AI features are disabled. Set AI_ENABLED=true and ANTHROPIC_API_KEY to enable them.',
    );
  }
}
