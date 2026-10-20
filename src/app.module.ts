import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { ClsModule, ClsService } from 'nestjs-cls';
import { CLS_IP, CLS_REQUEST_ID } from './common/cls.constants';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AppConfigModule } from './core/config/config.module';
import { LoggerModule } from './core/logger/logger.module';
import { MetricsModule } from './core/metrics/metrics.module';
import { PrismaModule } from './core/database/prisma.module';
import { RedisModule } from './core/redis/redis.module';
import { HealthModule } from './core/health/health.module';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { FilesModule } from './modules/files/files.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Root application module: core infrastructure + feature modules +
 * cross-cutting concerns (rate limit, envelopes, logging, exceptions) +
 * per-request context (CLS) and the event bus that powers audit logging.
 */
@Module({
  imports: [
    AppConfigModule,
    // Logger first: its middleware sets the request id that the CLS middleware
    // (mounted next) then reuses, so logs, envelopes and the audit trail share
    // one id.
    LoggerModule,
    EventEmitterModule.forRoot(),
    // AsyncLocalStorage: owns x-request-id (read-or-generate), client ip, and
    // the authenticated actor id (set by JwtStrategy). Mounted as middleware,
    // so the context exists for guards, interceptors, and event listeners.
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls: ClsService, req: Request, res: Response) => {
          const header = req.headers['x-request-id'];
          const id =
            typeof header === 'string' && header.length > 0
              ? header
              : randomUUID();
          req.headers['x-request-id'] = id;
          res.setHeader('x-request-id', id);
          cls.set(CLS_REQUEST_ID, id);
          cls.set(CLS_IP, req.ip ?? null);
        },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('throttle.ttl', 60000),
            limit: config.get<number>('throttle.limit', 100),
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    MetricsModule,
    AuditModule,
    UsersModule,
    RbacModule,
    AuthModule,
    FilesModule,
    NotificationsModule,
    AiModule,
    ProjectsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
