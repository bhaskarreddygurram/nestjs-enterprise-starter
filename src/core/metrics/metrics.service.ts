import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

/**
 * Owns a Prometheus registry: Node/process default metrics plus per-request
 * HTTP metrics. A dedicated (non-global) registry keeps repeated app bootstraps
 * (e.g. the e2e suite) from clashing on duplicate metric registration.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  private readonly httpTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  private readonly aiRequests = new Counter({
    name: 'ai_requests_total',
    help: 'Total number of AI provider requests',
    labelNames: ['provider', 'model', 'status'] as const,
    registers: [this.registry],
  });

  private readonly aiTokens = new Counter({
    name: 'ai_tokens_total',
    help: 'Total tokens consumed by AI provider requests',
    labelNames: ['provider', 'model', 'type'] as const,
    registers: [this.registry],
  });

  private readonly aiDuration = new Histogram({
    name: 'ai_request_duration_seconds',
    help: 'Duration of AI provider requests in seconds',
    labelNames: ['provider', 'model', 'status'] as const,
    buckets: [0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  /** Record one completed HTTP request. */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpDuration.observe(labels, durationSeconds);
    this.httpTotal.inc(labels);
  }

  /** Record one AI provider request (success or failure) plus token usage. */
  recordAiRequest(params: {
    provider: string;
    model: string;
    status: 'success' | 'error';
    durationSeconds: number;
    inputTokens?: number;
    outputTokens?: number;
  }): void {
    const { provider, model, status } = params;
    this.aiRequests.inc({ provider, model, status });
    this.aiDuration.observe(
      { provider, model, status },
      params.durationSeconds,
    );
    if (params.inputTokens) {
      this.aiTokens.inc({ provider, model, type: 'input' }, params.inputTokens);
    }
    if (params.outputTokens) {
      this.aiTokens.inc(
        { provider, model, type: 'output' },
        params.outputTokens,
      );
    }
  }

  /** Prometheus exposition text. */
  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
