/**
 * Typed application configuration.
 *
 * Loaded once via `@nestjs/config` and accessed through `ConfigService`
 * using dot-notation keys (e.g. `config.get('api.prefix')`).
 * Raw `process.env` access is intentionally confined to this file.
 */
export interface AppConfig {
  env: string;
  port: number;
  api: {
    prefix: string;
    version: string;
  };
  swagger: {
    enabled: boolean;
  };
  cors: {
    origins: string;
  };
  database: {
    url: string;
  };
  redis: {
    /** Full connection URL (redis:// or rediss://). If set, it wins over the discrete fields. */
    url?: string;
    host: string;
    port: number;
    password?: string;
    db: number;
    tls: boolean;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshExpiresInDays: number;
  };
  throttle: {
    ttl: number;
    limit: number;
  };
  upload: {
    dir: string;
    maxSizeBytes: number;
    allowedMimeTypes: string[];
  };
  mail: {
    transport: 'console' | 'smtp';
    from: string;
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
  };
  log: {
    level: string;
  };
  metrics: {
    enabled: boolean;
  };
  ai: {
    /** Master switch. When false (or no apiKey), AI endpoints return 503. */
    enabled: boolean;
    /** Anthropic API key. Absent → the noop provider is used. */
    apiKey?: string;
    /** Claude model id (e.g. claude-opus-4-8). */
    model: string;
    /** Hard cap on output tokens per request. */
    maxTokens: number;
    /** Request timeout in milliseconds. */
    timeoutMs: number;
  };
  security: {
    maxLoginAttempts: number;
    lockoutMinutes: number;
    passwordResetTtlMinutes: number;
    appWebUrl: string;
    twoFactorIssuer: string;
    twoFactorChallengeTtl: string;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  api: {
    prefix: process.env.API_PREFIX ?? 'api',
    version: process.env.API_VERSION ?? 'v1',
  },
  swagger: {
    enabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
  },
  cors: {
    origins: process.env.CORS_ORIGINS ?? '*',
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL || undefined,
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    // Managed Redis (Upstash, Redis Cloud, etc.) requires TLS (rediss://).
    tls: (process.env.REDIS_TLS ?? 'false') === 'true',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresInDays: parseInt(
      process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? '7',
      10,
    ),
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  upload: {
    dir: process.env.UPLOAD_DIR ?? './uploads',
    maxSizeBytes:
      parseInt(process.env.UPLOAD_MAX_SIZE_MB ?? '5', 10) * 1024 * 1024,
    allowedMimeTypes: (
      process.env.UPLOAD_ALLOWED_MIME ??
      'image/png,image/jpeg,image/gif,application/pdf,text/plain'
    )
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  },
  mail: {
    transport: (process.env.MAIL_TRANSPORT ?? 'console') as 'console' | 'smtp',
    from: process.env.MAIL_FROM ?? 'no-reply@enterprise.local',
    host: process.env.MAIL_HOST || undefined,
    port: parseInt(process.env.MAIL_PORT ?? '587', 10),
    secure: (process.env.MAIL_SECURE ?? 'false') === 'true',
    user: process.env.MAIL_USER || undefined,
    password: process.env.MAIL_PASSWORD || undefined,
  },
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
  metrics: {
    enabled: (process.env.METRICS_ENABLED ?? 'true') === 'true',
  },
  ai: {
    // Enabled only when explicitly turned on AND an API key is present.
    enabled:
      (process.env.AI_ENABLED ?? 'false') === 'true' &&
      Boolean(process.env.ANTHROPIC_API_KEY),
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    model: process.env.AI_MODEL ?? 'claude-opus-4-8',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS ?? '2048', 10),
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS ?? '30000', 10),
  },
  security: {
    maxLoginAttempts: parseInt(
      process.env.SECURITY_MAX_LOGIN_ATTEMPTS ?? '5',
      10,
    ),
    lockoutMinutes: parseInt(process.env.SECURITY_LOCKOUT_MINUTES ?? '15', 10),
    passwordResetTtlMinutes: parseInt(
      process.env.PASSWORD_RESET_TTL_MINUTES ?? '30',
      10,
    ),
    appWebUrl: process.env.APP_WEB_URL ?? 'http://localhost:3000',
    twoFactorIssuer: process.env.TWO_FACTOR_ISSUER ?? 'Enterprise Starter',
    twoFactorChallengeTtl: process.env.TWO_FACTOR_CHALLENGE_TTL ?? '5m',
  },
});
