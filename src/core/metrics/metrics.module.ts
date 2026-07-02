import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

/**
 * Prometheus metrics: default Node/process metrics + per-request HTTP metrics,
 * exposed at GET /metrics. The interceptor is registered globally so every
 * route is measured. Global + exported so feature modules (e.g. AI) can inject
 * MetricsService to record domain metrics into the same registry.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
