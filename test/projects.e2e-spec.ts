import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

interface ProjectBody {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  budget: string | null;
  currency: string | null;
  owner: { id: string; firstName: string | null; lastName: string | null };
  version: number;
}

interface PageMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface ErrorBody {
  message: string;
  errorCode: string;
  errors: Array<{ message: string }> | null;
}

/**
 * Full journey for the Projects module against the real app + database.
 * Requires the docker infra (`npm run docker:up`), applied migrations and the
 * seed (`npm run db:seed`) so the admin holds the project:* permissions.
 *
 * Repeatable: every row this spec creates carries a per-run code prefix and a
 * per-run token in its name. List assertions search for that token, so seeded
 * or leftover rows never affect them, and `afterAll` removes exactly those rows.
 */
describe('Projects (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let noPermToken: string;

  const stamp = Date.now();
  const run = stamp.toString(36).toUpperCase(); // e.g. "MGK3X9AB"
  const prefix = `E${run}`;
  const token = `zq${run.toLowerCase()}`;
  const noPermEmail = `e2e-projects-noperm-${stamp}@example.com`;
  const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

  const http = (): App => app.getHttpServer() as App;
  const as = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });
  const admin = () => as(adminToken);

  const create = (body: Record<string, unknown>) =>
    request(http()).post('/api/v1/projects').set(admin()).send(body);

  /** Lists only this run's projects (plus any extra query params). */
  const list = (query: Record<string, string | number> = {}) =>
    request(http())
      .get('/api/v1/projects')
      .set(admin())
      .query({ search: token, ...query });

  const codesOf = (res: request.Response): string[] =>
    (res.body as { data: ProjectBody[] }).data.map((p) => p.code);
  const errorOf = (res: request.Response): ErrorBody => res.body as ErrorBody;
  const projectOf = (res: request.Response): ProjectBody =>
    (res.body as { data: ProjectBody }).data;

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
    prisma = app.get(PrismaService);

    const login = await request(http())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Admin123!ChangeMe' })
      .expect(200);
    const session = (
      login.body as { data: { accessToken: string; user: { id: string } } }
    ).data;
    adminToken = session.accessToken;
    adminId = session.user.id;

    // A freshly-registered user has no roles → no permissions.
    const reg = await request(http())
      .post('/api/v1/auth/register')
      .send({ email: noPermEmail, password: 'Str0ng!Passw0rd' })
      .expect(201);
    noPermToken = (reg.body as { data: { accessToken: string } }).data
      .accessToken;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { code: { startsWith: prefix } },
    });
    await prisma.user.deleteMany({ where: { email: noPermEmail } });
    await app.close();
  });

  describe('authentication and permissions', () => {
    it('rejects a request without a token → 401', () =>
      request(http()).get('/api/v1/projects').expect(401));

    it.each([
      ['GET', '/api/v1/projects'],
      ['POST', '/api/v1/projects'],
      ['GET', `/api/v1/projects/${UNKNOWN_ID}`],
      ['PATCH', `/api/v1/projects/${UNKNOWN_ID}`],
      ['DELETE', `/api/v1/projects/${UNKNOWN_ID}`],
      ['POST', `/api/v1/projects/${UNKNOWN_ID}/restore`],
    ])('%s %s without the permission → 403', async (method, path) => {
      const res = await request(http())
        [method.toLowerCase() as 'get'](path)
        .set(as(noPermToken));
      expect(res.status).toBe(403);
    });
  });

  describe('create', () => {
    it('creates a project with defaults, owned by the caller → 201', async () => {
      const res = await create({
        code: `${prefix}-MIN`,
        name: `  Minimal ${token}  `,
      }).expect(201);

      expect(projectOf(res)).toMatchObject({
        code: `${prefix}-MIN`,
        name: `Minimal ${token}`, // trimmed
        description: null,
        status: 'PLANNING',
        priority: 'MEDIUM',
        startDate: null,
        dueDate: null,
        completedAt: null,
        budget: null,
        currency: null,
        version: 1,
        owner: { id: adminId },
      });
      // internal columns never leave the API
      expect(projectOf(res)).not.toHaveProperty('createdById');
      expect(projectOf(res)).not.toHaveProperty('deletedAt');
    });

    it('round-trips dates as YYYY-MM-DD and budget with two decimals', async () => {
      const res = await create({
        code: `${prefix}-FULL`,
        name: `Full ${token}`,
        description: 'Has every optional field',
        status: 'ACTIVE',
        priority: 'CRITICAL',
        startDate: '2026-09-01',
        dueDate: '2026-12-15',
        budget: '1234.5',
        currency: 'EUR',
      }).expect(201);

      expect(projectOf(res)).toMatchObject({
        status: 'ACTIVE',
        priority: 'CRITICAL',
        startDate: '2026-09-01',
        dueDate: '2026-12-15',
        budget: '1234.50',
        currency: 'EUR',
      });
    });

    it('rejects a duplicate code → 409 from the unique constraint', async () => {
      const res = await create({
        code: `${prefix}-MIN`,
        name: 'Duplicate',
      }).expect(409);

      expect(errorOf(res)).toMatchObject({
        errorCode: 'CONFLICT',
        message: 'A record with this code already exists',
      });
    });

    it('lets only one of two simultaneous creates with the same code win', async () => {
      const body = { code: `${prefix}-RACE`, name: `Race ${token}` };

      const statuses = (await Promise.all([create(body), create(body)]))
        .map((res) => res.status)
        .sort();

      expect(statuses).toEqual([201, 409]);
    });

    it.each([
      ['a malformed code', { code: 'bad code' }],
      ['a blank name', { name: '   ' }],
      ['an unknown status', { status: 'DONE' }],
      ['an impossible date', { startDate: '2026-02-30' }],
      ['a numeric budget', { budget: 100, currency: 'EUR' }],
      ['a lowercase currency', { budget: '100', currency: 'eur' }],
      ['a null status', { status: null }],
      ['a server-owned field', { createdById: UNKNOWN_ID }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, override) => {
      const res = await create({
        code: `${prefix}-BAD`,
        name: 'Invalid',
        ...override,
      }).expect(400);

      expect(errorOf(res).errorCode).toBe('VALIDATION_ERROR');
    });

    it.each([
      [
        'a due date before the start date',
        { startDate: '2026-10-10', dueDate: '2026-10-09' },
        'dueDate must not be before startDate',
      ],
      [
        'a budget without a currency',
        { budget: '100.00' },
        'budget and currency must be provided together',
      ],
      [
        'an owner that does not exist',
        { ownerId: UNKNOWN_ID },
        `Owner with id "${UNKNOWN_ID}" not found`,
      ],
    ])('rejects %s → 400', async (_label, override, message) => {
      const res = await create({
        code: `${prefix}-BAD`,
        name: 'Invalid',
        ...override,
      }).expect(400);

      expect(errorOf(res).message).toBe(message);
    });

    it('never created the rejected project', async () => {
      const res = await request(http())
        .get('/api/v1/projects')
        .set(admin())
        .query({ search: `${prefix}-BAD` })
        .expect(200);

      expect(codesOf(res)).toEqual([]);
    });
  });

  describe('list, search, filter, sort', () => {
    // Fixture set for this block, on top of MIN / FULL / RACE created above.
    beforeAll(async () => {
      await create({
        code: `${prefix}-A`,
        name: `Alpha ${token}`,
        status: 'ON_HOLD',
        priority: 'LOW',
        dueDate: '2027-01-10',
      }).expect(201);
      await create({
        code: `${prefix}-B`,
        name: `Bravo ${token}`,
        description: 'needle-in-description',
        status: 'ACTIVE',
        priority: 'HIGH',
        dueDate: '2027-03-20',
      }).expect(201);
    });

    it('finds this run by a token in the name, with pagination meta', async () => {
      const res = await list().expect(200);

      expect(codesOf(res).sort()).toEqual(
        [
          `${prefix}-A`,
          `${prefix}-B`,
          `${prefix}-FULL`,
          `${prefix}-MIN`,
          `${prefix}-RACE`,
        ].sort(),
      );
      expect((res.body as { meta: PageMeta }).meta).toMatchObject({
        page: 1,
        limit: 20,
        totalItems: 5,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });

    it('searches code and description too, case-insensitively', async () => {
      const byCode = await request(http())
        .get('/api/v1/projects')
        .set(admin())
        .query({ search: `${prefix}-b`.toLowerCase() })
        .expect(200);
      expect(codesOf(byCode)).toEqual([`${prefix}-B`]);

      const byDescription = await list({ search: 'NEEDLE-IN-DESC' }).expect(
        200,
      );
      expect(codesOf(byDescription)).toContain(`${prefix}-B`);
    });

    it('filters by one or more statuses', async () => {
      const res = await list({ status: 'ACTIVE,ON_HOLD' }).expect(200);

      expect(codesOf(res).sort()).toEqual(
        [`${prefix}-A`, `${prefix}-B`, `${prefix}-FULL`].sort(),
      );
    });

    it('filters by priority', async () => {
      const res = await list({ priority: 'LOW' }).expect(200);

      expect(codesOf(res)).toEqual([`${prefix}-A`]);
    });

    it('filters by owner', async () => {
      const mine = await list({ ownerId: adminId }).expect(200);
      expect(codesOf(mine)).toHaveLength(5);

      const nobody = await list({ ownerId: UNKNOWN_ID }).expect(200);
      expect(codesOf(nobody)).toEqual([]);
    });

    it('filters by an inclusive due-date range', async () => {
      const res = await list({
        dueFrom: '2027-01-10',
        dueTo: '2027-03-20',
      }).expect(200);

      expect(codesOf(res).sort()).toEqual([`${prefix}-A`, `${prefix}-B`]);
    });

    it('combines search and filters with AND', async () => {
      const res = await list({
        status: 'ACTIVE',
        priority: 'HIGH',
      }).expect(200);

      expect(codesOf(res)).toEqual([`${prefix}-B`]);
    });

    it('sorts ascending and descending', async () => {
      const asc = await list({ sort: 'name' }).expect(200);
      const desc = await list({ sort: '-name' }).expect(200);

      expect(codesOf(asc)[0]).toBe(`${prefix}-A`);
      expect(codesOf(desc)).toEqual([...codesOf(asc)].reverse());
    });

    it('puts projects without a due date last in both directions', async () => {
      const dated = [`${prefix}-FULL`, `${prefix}-A`, `${prefix}-B`];

      const asc = await list({ sort: 'dueDate' }).expect(200);
      const desc = await list({ sort: '-dueDate' }).expect(200);

      expect(codesOf(asc).slice(0, 3)).toEqual(dated);
      expect(codesOf(desc).slice(0, 3)).toEqual([...dated].reverse());
    });

    it('sorts priority by severity, not alphabetically', async () => {
      const res = await list({ sort: '-priority' }).expect(200);

      // CRITICAL (FULL) > HIGH (B) > MEDIUM > LOW (A)
      expect(codesOf(res)[0]).toBe(`${prefix}-FULL`);
      expect(codesOf(res)[1]).toBe(`${prefix}-B`);
      expect(codesOf(res).at(-1)).toBe(`${prefix}-A`);
    });

    it('pages without overlap or gaps', async () => {
      const pageOf = (page: number) =>
        list({ sort: 'code', limit: 2, page }).expect(200);
      const [p1, p2, p3] = await Promise.all([pageOf(1), pageOf(2), pageOf(3)]);

      expect((p1.body as { meta: PageMeta }).meta).toMatchObject({
        totalItems: 5,
        totalPages: 3,
        hasNext: true,
        hasPrev: false,
      });
      expect((p3.body as { meta: PageMeta }).meta).toMatchObject({
        hasNext: false,
        hasPrev: true,
      });
      const all = [...codesOf(p1), ...codesOf(p2), ...codesOf(p3)];
      expect(all).toHaveLength(5);
      expect(new Set(all).size).toBe(5);
      expect(all).toEqual([...all].sort());
    });

    it.each([
      ['a sort field outside the whitelist', { sort: 'budget' }],
      ['an unknown status', { status: 'ACTIVE,DONE' }],
      ['a limit above 100', { limit: 101 }],
      ['a malformed date', { dueFrom: '10.01.2027' }],
      [
        'a due range that ends before it starts',
        { dueFrom: '2027-02-01', dueTo: '2027-01-01' },
      ],
      ['an unknown filter', { budget: '100' }],
    ])('rejects %s → 400', async (_label, query) => {
      await list(query).expect(400);
    });
  });

  describe('get one', () => {
    it('returns the project → 200', async () => {
      const created = projectOf(
        await create({ code: `${prefix}-GET`, name: 'Get me' }).expect(201),
      );

      const res = await request(http())
        .get(`/api/v1/projects/${created.id}`)
        .set(admin())
        .expect(200);

      expect(projectOf(res)).toEqual(created);
    });

    it('unknown id → 404, malformed id → 400', async () => {
      await request(http())
        .get(`/api/v1/projects/${UNKNOWN_ID}`)
        .set(admin())
        .expect(404);
      await request(http())
        .get('/api/v1/projects/not-a-uuid')
        .set(admin())
        .expect(400);
    });
  });

  describe('update with optimistic locking', () => {
    let project: ProjectBody;

    const patch = (body: Record<string, unknown>, id = project.id) =>
      request(http()).patch(`/api/v1/projects/${id}`).set(admin()).send(body);

    beforeAll(async () => {
      project = projectOf(
        await create({
          code: `${prefix}-UPD`,
          name: 'To update',
          startDate: '2026-09-01',
          dueDate: '2026-12-15',
          budget: '500.00',
          currency: 'EUR',
        }).expect(201),
      );
    });

    it('applies a change and increments the version → 200', async () => {
      const res = await patch({ version: 1, name: 'Updated' }).expect(200);

      expect(projectOf(res)).toMatchObject({
        name: 'Updated',
        version: 2,
        // untouched fields keep their values
        startDate: '2026-09-01',
        budget: '500.00',
      });
    });

    it('rejects a stale version → 409 and changes nothing', async () => {
      const res = await patch({ version: 1, name: 'Lost update' }).expect(409);

      expect(errorOf(res).message).toContain('current version 2');
      const current = await request(http())
        .get(`/api/v1/projects/${project.id}`)
        .set(admin())
        .expect(200);
      expect(projectOf(current)).toMatchObject({ name: 'Updated', version: 2 });
    });

    it('lets only one of two simultaneous updates on the same version win', async () => {
      const results = await Promise.all([
        patch({ version: 2, priority: 'HIGH' }),
        patch({ version: 2, priority: 'LOW' }),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const winner = results.find((res) => res.status === 200);
      expect(projectOf(winner as request.Response).version).toBe(3);
    });

    it('stamps completedAt on COMPLETED and clears it on leaving', async () => {
      const done = await patch({ version: 3, status: 'COMPLETED' }).expect(200);
      expect(projectOf(done).completedAt).not.toBeNull();

      const reopened = await patch({ version: 4, status: 'ACTIVE' }).expect(
        200,
      );
      expect(projectOf(reopened)).toMatchObject({
        status: 'ACTIVE',
        completedAt: null,
        version: 5,
      });
    });

    it('validates a partial change against the stored values → 400', async () => {
      // stored startDate is 2026-09-01
      const dates = await patch({ version: 5, dueDate: '2026-08-01' }).expect(
        400,
      );
      expect(errorOf(dates).message).toBe(
        'dueDate must not be before startDate',
      );

      // stored currency is EUR
      const money = await patch({ version: 5, budget: null }).expect(400);
      expect(errorOf(money).message).toBe(
        'budget and currency must be provided together',
      );
    });

    it('clears nullable fields with null', async () => {
      const res = await patch({
        version: 5,
        budget: null,
        currency: null,
        dueDate: null,
      }).expect(200);

      expect(projectOf(res)).toMatchObject({
        budget: null,
        currency: null,
        dueDate: null,
        version: 6,
      });
    });

    it.each([
      ['a missing version', { name: 'x' }],
      ['an attempt to change code', { version: 6, code: 'NEW-CODE' }],
      ['null on a required field', { version: 6, name: null }],
      ['an unknown status', { version: 6, status: 'DONE' }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await patch(body).expect(400);

      expect(errorOf(res).errorCode).toBe('VALIDATION_ERROR');
    });

    it('unknown id → 404', () =>
      patch({ version: 1, name: 'x' }, UNKNOWN_ID).expect(404));
  });

  describe('soft delete and restore', () => {
    let project: ProjectBody;
    const url = () => `/api/v1/projects/${project.id}`;

    beforeAll(async () => {
      project = projectOf(
        await create({
          code: `${prefix}-DEL`,
          name: `Deletable ${token}`,
        }).expect(201),
      );
    });

    it('cannot restore a project that is not deleted → 404', () =>
      request(http()).post(`${url()}/restore`).set(admin()).expect(404));

    it('soft-deletes → 204, and a second delete → 404', async () => {
      await request(http()).delete(url()).set(admin()).expect(204);
      await request(http()).delete(url()).set(admin()).expect(404);
    });

    it('hides the project from get, update and the default list', async () => {
      await request(http()).get(url()).set(admin()).expect(404);
      await request(http())
        .patch(url())
        .set(admin())
        .send({ version: 2, name: 'x' })
        .expect(404);

      const res = await list().expect(200);
      expect(codesOf(res)).not.toContain(project.code);
    });

    it('keeps the row and records who deleted it', async () => {
      const row = await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
      });

      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedById).toBe(adminId);
    });

    it('lists it under deleted=only', async () => {
      const res = await list({ deleted: 'only' }).expect(200);

      expect(codesOf(res)).toEqual([project.code]);
    });

    it('keeps the code reserved → 409 on reuse', () =>
      create({ code: project.code, name: 'Reuse' }).expect(409));

    it('restores the project → 200 and it is readable again', async () => {
      const res = await request(http())
        .post(`${url()}/restore`)
        .set(admin())
        .expect(200);
      expect(projectOf(res)).toMatchObject({ code: project.code, version: 3 });

      await request(http()).get(url()).set(admin()).expect(200);
      const deleted = await list({ deleted: 'only' }).expect(200);
      expect(codesOf(deleted)).toEqual([]);
    });
  });

  describe('audit trail', () => {
    it('records every write with its actor', async () => {
      const created = projectOf(
        await create({ code: `${prefix}-AUD`, name: 'Audited' }).expect(201),
      );
      const url = `/api/v1/projects/${created.id}`;
      await request(http())
        .patch(url)
        .set(admin())
        .send({ version: 1, name: 'Audited 2', priority: 'HIGH' })
        .expect(200);
      await request(http()).delete(url).set(admin()).expect(204);
      await request(http()).post(`${url}/restore`).set(admin()).expect(200);

      // audit rows are written by an event listener, after the response
      const expected = [
        'project.created',
        'project.updated',
        'project.deleted',
        'project.restored',
      ];
      let rows: Array<{
        action: string;
        actorId: string | null;
        metadata: unknown;
      }> = [];
      for (let attempt = 0; attempt < 20 && rows.length < 4; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        rows = await prisma.auditLog.findMany({
          where: { resource: 'project', resourceId: created.id },
          orderBy: { createdAt: 'asc' },
        });
      }

      expect(rows.map((row) => row.action)).toEqual(expected);
      expect(rows.every((row) => row.actorId === adminId)).toBe(true);
      expect(rows[1].metadata).toEqual({ fields: ['name', 'priority'] });
    });
  });
});
