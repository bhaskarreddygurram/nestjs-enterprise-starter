import { randomUUID } from 'crypto';
import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage, ServerResponse } from 'http';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { LoggerOptions } from 'pino';

/**
 * Structured logging via Pino.
 *
 *  - JSON logs in production (machine-parseable, ship to Loki/ELK/Datadog).
 *  - Pretty-printed in development; silenced under `test`.
 *  - With LOG_TO_FILE=true, also writes raw JSON lines to <LOG_DIR>/app.log
 *    (in addition to stdout) — useful on a VPS where you want on-disk logs.
 *  - Every log line carries the request id (`reqId`), reusing the inbound
 *    `x-request-id` header so logs correlate with the response envelope, the
 *    audit trail (CLS), and across services.
 *  - Sensitive headers are redacted.
 *
 * This must be imported FIRST in the root module so its middleware runs before
 * the CLS middleware, which then reuses the same request id.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const env = config.get<string>('env', 'development');
        const isDev = env === 'development';
        const isTest = env === 'test';
        const level = isTest
          ? 'silent'
          : config.get<string>('log.level', 'info');
        const toFile = config.get<boolean>('log.toFile', false);
        const logDir = config.get<string>('log.dir', './logs');

        const prettyOptions = {
          singleLine: true,
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        };
        // Console target: pretty in dev, raw JSON to stdout (fd 1) otherwise.
        const consoleTarget = isDev
          ? { target: 'pino-pretty', level, options: prettyOptions }
          : { target: 'pino/file', level, options: { destination: 1 } };
        // Rotating is left to the OS (logrotate) / platform; we append JSON.
        const fileTarget = {
          target: 'pino/file',
          level,
          options: { destination: join(logDir, 'app.log'), mkdir: true },
        };

        // Defaults preserved: dev → pretty stdout, prod → raw JSON stdout,
        // test → silent. File logging adds a second target only when enabled.
        let transport: LoggerOptions['transport'];
        if (isTest) {
          transport = undefined;
        } else if (toFile) {
          transport = { targets: [consoleTarget, fileTarget] };
        } else if (isDev) {
          transport = { target: 'pino-pretty', options: prettyOptions };
        } else {
          transport = undefined;
        }

        return {
          pinoHttp: {
            level,
            transport,
            // Reuse the inbound request id (or mint one) and echo it back.
            genReqId: (req: IncomingMessage, res: ServerResponse): string => {
              const header = req.headers['x-request-id'];
              const id =
                typeof header === 'string' && header.length > 0
                  ? header
                  : randomUUID();
              req.headers['x-request-id'] = id;
              res.setHeader('x-request-id', id);
              return id;
            },
            // Keep request/response log objects lean.
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: { statusCode: number }) => ({
                statusCode: res.statusCode,
              }),
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
              ],
              remove: true,
            },
            // /health and /metrics are scraped constantly — don't log them.
            autoLogging: {
              ignore: (req: IncomingMessage) =>
                req.url === '/metrics' ||
                req.url?.startsWith('/api/v1/health') === true,
            },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
