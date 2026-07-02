import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { MetricsService } from '../../core/metrics/metrics.service';
import { AnthropicAiProvider } from './anthropic-ai.provider';
import { AuditEventSummary } from './ai.interface';

jest.mock('@anthropic-ai/sdk');

const create = jest.fn();
(Anthropic as unknown as jest.Mock).mockImplementation(() => ({
  messages: { create },
}));

const config = {
  get: jest.fn((key: string, def?: unknown) => {
    const values: Record<string, unknown> = {
      'ai.model': 'claude-opus-4-8',
      'ai.maxTokens': 2048,
      'ai.apiKey': 'sk-ant-test',
      'ai.timeoutMs': 30000,
    };
    return values[key] ?? def;
  }),
} as unknown as ConfigService;

const metrics = {
  recordAiRequest: jest.fn(),
} as unknown as jest.Mocked<Pick<MetricsService, 'recordAiRequest'>>;

const events: AuditEventSummary[] = [
  {
    action: 'auth.login.failed',
    actorId: 'u1',
    resource: 'auth',
    resourceId: null,
    ipAddress: '10.0.0.1',
    createdAt: new Date().toISOString(),
  },
];

describe('AnthropicAiProvider', () => {
  beforeEach(() => {
    create.mockReset();
    metrics.recordAiRequest.mockClear();
  });

  it('is enabled', () => {
    const provider = new AnthropicAiProvider(
      config,
      metrics as unknown as MetricsService,
    );
    expect(provider.enabled).toBe(true);
  });

  it('parses structured output and records token usage', async () => {
    const analysis = {
      summary: 'One account shows repeated failed logins.',
      riskLevel: 'medium',
      findings: [
        {
          title: 'Repeated failed logins',
          severity: 'medium',
          description: 'Several failures for u1.',
          recommendation: 'Review the account.',
          relatedActions: ['auth.login.failed'],
        },
      ],
    };
    create.mockResolvedValue({
      model: 'claude-opus-4-8',
      content: [{ type: 'text', text: JSON.stringify(analysis) }],
      usage: { input_tokens: 1200, output_tokens: 300 },
    });

    const provider = new AnthropicAiProvider(
      config,
      metrics as unknown as MetricsService,
    );
    const result = await provider.analyzeSecurityEvents({
      events,
      windowHours: 24,
    });

    expect(result.analysis.riskLevel).toBe('medium');
    expect(result.analysis.findings).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    expect(metrics.recordAiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        status: 'success',
        inputTokens: 1200,
        outputTokens: 300,
      }),
    );
  });

  it('records a failure and throws 503 when the API call fails', async () => {
    create.mockRejectedValue(new Error('network down'));

    const provider = new AnthropicAiProvider(
      config,
      metrics as unknown as MetricsService,
    );

    await expect(
      provider.analyzeSecurityEvents({ events, windowHours: 24 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(metrics.recordAiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });
});
