import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Server } from 'http';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * AI security-insights endpoint. In the test/CI environment AI is disabled
 * (no AI_ENABLED / ANTHROPIC_API_KEY), so we assert the auth + permission
 * gating and the graceful 503 "disabled" path — no live model call is made.
 * Requires docker infra + seed (admin has ai:read).
 */
describe('AI security insights (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let noPermToken: string;

  const stamp = Date.now();
  const http = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    const login = await request(http())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Admin123!ChangeMe' })
      .expect(200);
    adminToken = (login.body as { data: { accessToken: string } }).data
      .accessToken;

    const reg = await request(http())
      .post('/api/v1/auth/register')
      .send({
        email: `e2e-ai-noperm-${stamp}@example.com`,
        password: 'Str0ng!Passw0rd',
      })
      .expect(201);
    noPermToken = (reg.body as { data: { accessToken: string } }).data
      .accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests → 401', () => {
    return request(http()).get('/api/v1/ai/security-insights').expect(401);
  });

  it('rejects callers without ai:read → 403', () => {
    return request(http())
      .get('/api/v1/ai/security-insights')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('validates query params (hours out of range) → 400', () => {
    return request(http())
      .get('/api/v1/ai/security-insights?hours=9999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('admin with ai:read gets 503 while AI is disabled', () => {
    return request(http())
      .get('/api/v1/ai/security-insights')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(503);
  });
});
