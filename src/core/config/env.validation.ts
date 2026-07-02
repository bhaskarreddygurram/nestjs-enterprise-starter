import * as Joi from 'joi';

/**
 * Validates environment variables at boot time.
 * The app fails fast (and loudly) if configuration is missing or malformed,
 * rather than failing later at runtime in an unexpected place.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  API_PREFIX: Joi.string().default('api'),
  API_VERSION: Joi.string().default('v1'),

  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),

  CORS_ORIGINS: Joi.string().default('*'),

  // Database (PostgreSQL) — consumed by Prisma and the app
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  // Redis
  // Optional full URL (overrides REDIS_HOST/PORT/PASSWORD/TLS); rediss:// = TLS.
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).default(0),
  REDIS_TLS: Joi.boolean().truthy('true').falsy('false').default(false),

  // JWT access tokens
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),

  // Refresh tokens (opaque, DB-backed, rotated)
  JWT_REFRESH_EXPIRES_IN_DAYS: Joi.number().integer().min(1).default(7),

  // Rate limiting (global default; auth routes are stricter via @Throttle)
  THROTTLE_TTL: Joi.number().integer().min(1000).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),

  // File uploads
  UPLOAD_DIR: Joi.string().default('./uploads'),
  UPLOAD_MAX_SIZE_MB: Joi.number().integer().min(1).default(5),
  UPLOAD_ALLOWED_MIME: Joi.string().default(
    'image/png,image/jpeg,image/gif,application/pdf,text/plain',
  ),

  // Mail (console transport in dev; set MAIL_TRANSPORT=smtp + creds for prod)
  MAIL_FROM: Joi.string().default('no-reply@enterprise.local'),
  MAIL_TRANSPORT: Joi.string().valid('console', 'smtp').default('console'),
  MAIL_HOST: Joi.string().when('MAIL_TRANSPORT', {
    is: 'smtp',
    then: Joi.required(),
  }),
  MAIL_PORT: Joi.number().port().default(587),
  MAIL_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  MAIL_USER: Joi.string().allow('').optional(),
  MAIL_PASSWORD: Joi.string().allow('').optional(),

  // Observability (Phase 11): structured logging + Prometheus metrics
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  // Also write structured JSON logs to files under LOG_DIR (in addition to stdout).
  LOG_TO_FILE: Joi.boolean().truthy('true').falsy('false').default(false),
  LOG_DIR: Joi.string().default('./logs'),
  METRICS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),

  // AI (Phase 13): Claude-powered security insights over the audit log.
  // Disabled by default; the endpoint returns 503 until AI_ENABLED=true AND
  // ANTHROPIC_API_KEY is set. AI_ENABLED without a key is rejected at boot.
  AI_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  ANTHROPIC_API_KEY: Joi.string().when('AI_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  AI_MODEL: Joi.string().default('claude-opus-4-8'),
  AI_MAX_TOKENS: Joi.number().integer().min(256).default(2048),
  AI_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),

  // Security depth (Phase 10): lockout, password reset, 2FA
  SECURITY_MAX_LOGIN_ATTEMPTS: Joi.number().integer().min(1).default(5),
  SECURITY_LOCKOUT_MINUTES: Joi.number().integer().min(1).default(15),
  PASSWORD_RESET_TTL_MINUTES: Joi.number().integer().min(1).default(30),
  APP_WEB_URL: Joi.string().uri().default('http://localhost:3000'),
  TWO_FACTOR_ISSUER: Joi.string().default('Enterprise Starter'),
  TWO_FACTOR_CHALLENGE_TTL: Joi.string().default('5m'),

  // Postgres container credentials (used by docker-compose; optional for the app)
  POSTGRES_USER: Joi.string().optional(),
  POSTGRES_PASSWORD: Joi.string().optional(),
  POSTGRES_DB: Joi.string().optional(),
  POSTGRES_PORT: Joi.number().port().optional(),
});
