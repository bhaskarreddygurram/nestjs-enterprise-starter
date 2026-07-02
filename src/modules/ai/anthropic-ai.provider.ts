import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { MetricsService } from '../../core/metrics/metrics.service';
import {
  AiProvider,
  AuditEventSummary,
  SecurityAnalysis,
  SecurityAnalysisResult,
} from './ai.interface';

/**
 * JSON Schema the model must conform to. Structured outputs guarantee the
 * response parses — no brittle prompt-coaxing or regex extraction. Every object
 * sets additionalProperties:false and lists all keys in `required`, as the
 * structured-output validator requires.
 */
const SECURITY_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'string',
      description:
        'Two or three sentences summarising overall security posture.',
    },
    riskLevel: {
      type: 'string',
      enum: ['low', 'medium', 'high', 'critical'],
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: {
            type: 'string',
            enum: ['info', 'low', 'medium', 'high', 'critical'],
          },
          description: { type: 'string' },
          recommendation: { type: 'string' },
          relatedActions: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'title',
          'severity',
          'description',
          'recommendation',
          'relatedActions',
        ],
      },
    },
  },
  required: ['summary', 'riskLevel', 'findings'],
} as const;

const SYSTEM_PROMPT = [
  'You are a security analyst for a backend platform.',
  'You are given a batch of recent audit-log events (JSON).',
  'Assess the security posture: spot anomalies such as repeated failed logins,',
  'account lockouts, permission or role changes, password resets, and access',
  'from unusual actors or IP addresses. Correlate events by actor and IP.',
  'Be precise and evidence-based: only raise a finding you can tie to specific',
  'events, and reference their audit `action` values in relatedActions. If the',
  'events look benign, say so plainly and return an empty findings array.',
  'Do not invent events that are not present in the input.',
].join(' ');

/**
 * Anthropic (Claude) implementation of {@link AiProvider}. Uses the Messages API
 * with structured outputs so the response is a guaranteed-valid JSON object.
 * Token usage and latency are recorded into the shared Prometheus registry.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly enabled = true;

  private readonly logger = new Logger(AnthropicAiProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly providerLabel = 'anthropic';

  constructor(
    config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.model = config.get<string>('ai.model', 'claude-opus-4-8');
    this.maxTokens = config.get<number>('ai.maxTokens', 2048);
    this.client = new Anthropic({
      apiKey: config.get<string>('ai.apiKey'),
      timeout: config.get<number>('ai.timeoutMs', 30000),
    });
  }

  async analyzeSecurityEvents(input: {
    events: AuditEventSummary[];
    windowHours: number;
  }): Promise<SecurityAnalysisResult> {
    const startedAt = Date.now();
    const userContent =
      `Analyse these ${input.events.length} audit event(s) from the last ` +
      `${input.windowHours} hour(s):\n\n` +
      JSON.stringify(input.events);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
        // Structured output + low effort: cheap, fast, deterministic-ish.
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: SECURITY_ANALYSIS_SCHEMA },
        },
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      const analysis = JSON.parse(text) as SecurityAnalysis;

      this.metrics.recordAiRequest({
        provider: this.providerLabel,
        model: response.model,
        status: 'success',
        durationSeconds: (Date.now() - startedAt) / 1000,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });

      return {
        analysis,
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      this.metrics.recordAiRequest({
        provider: this.providerLabel,
        model: this.model,
        status: 'error',
        durationSeconds: (Date.now() - startedAt) / 1000,
      });
      this.logger.error(
        `AI security analysis failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw new ServiceUnavailableException(
        'AI security analysis is temporarily unavailable.',
      );
    }
  }
}
