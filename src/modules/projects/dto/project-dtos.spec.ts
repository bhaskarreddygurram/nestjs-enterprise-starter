import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProjectWithOwner } from '../projects.types';
import { CreateProjectDto } from './create-project.dto';
import { ProjectQueryDto } from './project-query.dto';
import { ProjectResponseDto } from './project-response.dto';
import { UpdateProjectDto } from './update-project.dto';

// The same options main.ts gives the global pipe, so these specs exercise the
// HTTP contract exactly as a request would.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const parse = <T>(
  dto: Type<T>,
  value: unknown,
  type: 'body' | 'query' = 'body',
): Promise<T> => pipe.transform(value, { type, metatype: dto }) as Promise<T>;

/** Resolves to the validation messages of a rejected payload. */
const errorsOf = async (promise: Promise<unknown>): Promise<string[]> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { message: string[] }).message;
    }
    throw error;
  }
  throw new Error('expected the payload to be rejected');
};

describe('CreateProjectDto', () => {
  const valid = { code: 'CRM-2026', name: 'CRM Migration' };

  it('accepts the minimal payload', async () => {
    await expect(parse(CreateProjectDto, valid)).resolves.toMatchObject(valid);
  });

  it('accepts a full payload and trims text', async () => {
    const dto = await parse(CreateProjectDto, {
      ...valid,
      name: '  CRM Migration  ',
      description: ' text ',
      status: 'ACTIVE',
      priority: 'HIGH',
      startDate: '2026-09-01',
      dueDate: '2026-12-15',
      budget: '48000.00',
      currency: 'EUR',
      ownerId: '150944a0-7cf6-4deb-93d1-81903cd79391',
    });
    expect(dto.name).toBe('CRM Migration');
    expect(dto.description).toBe('text');
    expect(dto.startDate).toBe('2026-09-01');
    expect(dto.budget).toBe('48000.00');
  });

  it.each([
    ['lowercase', 'crm-2026'],
    ['leading digit', '1CRM'],
    ['too short', 'C'],
    ['too long', 'A'.repeat(21)],
    ['illegal character', 'CRM_2026'],
  ])('rejects a code that is %s', async (_label, code) => {
    const errors = await errorsOf(parse(CreateProjectDto, { ...valid, code }));
    expect(errors.join()).toContain('code must be');
  });

  it('requires code and name', async () => {
    const errors = (await errorsOf(parse(CreateProjectDto, {}))).join();
    expect(errors).toContain('code');
    expect(errors).toContain('name');
  });

  it('rejects a blank name', async () => {
    const errors = await errorsOf(
      parse(CreateProjectDto, { ...valid, name: '   ' }),
    );
    expect(errors).toContain('name should not be empty');
  });

  it.each([
    ['status', 'DONE'],
    ['priority', 'URGENT'],
    ['startDate', '2026-9-1'],
    ['startDate', '2026-02-30'],
    ['dueDate', '2026-12-15T10:00:00Z'],
    ['budget', '-5'],
    ['budget', '10.999'],
    ['budget', '1e5'],
    ['currency', 'eur'],
    ['currency', 'EURO'],
    ['ownerId', 'not-a-uuid'],
  ])('rejects %s = %s', async (field, value) => {
    const errors = await errorsOf(
      parse(CreateProjectDto, { ...valid, [field]: value }),
    );
    expect(errors.join()).toContain(field);
  });

  it('treats null on a nullable field as "no value"', async () => {
    const dto = await parse(CreateProjectDto, {
      ...valid,
      description: null,
      dueDate: null,
      budget: null,
    });
    expect(dto.description).toBeNull();
  });

  it.each(['status', 'priority', 'ownerId'])(
    'rejects null on the NOT NULL field %s',
    async (field) => {
      const errors = await errorsOf(
        parse(CreateProjectDto, { ...valid, [field]: null }),
      );
      expect(errors.join()).toContain(field);
    },
  );

  it('rejects unknown and server-owned properties', async () => {
    const errors = await errorsOf(
      parse(CreateProjectDto, {
        ...valid,
        completedAt: '2026-01-01',
        createdById: '150944a0-7cf6-4deb-93d1-81903cd79391',
        version: 9,
      }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'property completedAt should not exist',
        'property createdById should not exist',
        'property version should not exist',
      ]),
    );
  });
});

describe('UpdateProjectDto', () => {
  it('accepts a version-only payload', async () => {
    await expect(parse(UpdateProjectDto, { version: 1 })).resolves.toEqual({
      version: 1,
    });
  });

  it('requires an integer version >= 1', async () => {
    expect((await errorsOf(parse(UpdateProjectDto, {}))).join()).toContain(
      'version',
    );
    expect(
      (await errorsOf(parse(UpdateProjectDto, { version: 0 }))).join(),
    ).toContain('version');
    expect(
      (await errorsOf(parse(UpdateProjectDto, { version: 1.5 }))).join(),
    ).toContain('version');
  });

  it('does not allow changing code', async () => {
    const errors = await errorsOf(
      parse(UpdateProjectDto, { version: 1, code: 'NEW-CODE' }),
    );
    expect(errors).toContain('property code should not exist');
  });

  it('lets null clear a nullable field', async () => {
    const dto = await parse(UpdateProjectDto, {
      version: 2,
      description: null,
      startDate: null,
      dueDate: null,
      budget: null,
      currency: null,
    });
    expect(dto).toEqual({
      version: 2,
      description: null,
      startDate: null,
      dueDate: null,
      budget: null,
      currency: null,
    });
  });

  it.each(['name', 'status', 'priority', 'ownerId'])(
    'rejects null on the NOT NULL field %s',
    async (field) => {
      const errors = await errorsOf(
        parse(UpdateProjectDto, { version: 1, [field]: null }),
      );
      expect(errors.join()).toContain(field);
    },
  );

  it('still validates the fields that are sent', async () => {
    const errors = await errorsOf(
      parse(UpdateProjectDto, { version: 1, status: 'DONE', budget: 'abc' }),
    );
    expect(errors.join()).toContain('status');
    expect(errors.join()).toContain('budget');
  });
});

describe('ProjectQueryDto', () => {
  const query = (value: Record<string, unknown>): Promise<ProjectQueryDto> =>
    parse(ProjectQueryDto, value, 'query');

  it('applies defaults to an empty query', async () => {
    const dto = await query({});
    expect(dto).toMatchObject({ page: 1, limit: 20, deleted: 'exclude' });
    expect(dto.skip).toBe(0);
  });

  it('splits comma-separated enums into arrays', async () => {
    const dto = await query({
      status: 'ACTIVE, ON_HOLD',
      priority: 'CRITICAL',
    });
    expect(dto.status).toEqual(['ACTIVE', 'ON_HOLD']);
    expect(dto.priority).toEqual(['CRITICAL']);
  });

  it('accepts repeated query parameters', async () => {
    const dto = await query({ status: ['ACTIVE', 'COMPLETED'] });
    expect(dto.status).toEqual(['ACTIVE', 'COMPLETED']);
  });

  it('rejects an unknown enum value inside a list', async () => {
    const errors = await errorsOf(query({ status: 'ACTIVE,DONE' }));
    expect(errors.join()).toContain('status');
  });

  it('converts paging strings and trims search', async () => {
    const dto = await query({ page: '3', limit: '10', search: '  crm ' });
    expect(dto).toMatchObject({ page: 3, limit: 10, search: 'crm' });
    expect(dto.skip).toBe(20);
  });

  it.each([
    ['limit', '101'],
    ['page', '0'],
    ['ownerId', 'abc'],
    ['dueFrom', '01.12.2026'],
    ['dueTo', '2026-13-01'],
    ['deleted', 'include'],
    ['search', 'x'.repeat(101)],
  ])('rejects %s = %s', async (field, value) => {
    const errors = await errorsOf(query({ [field]: value }));
    expect(errors.join()).toContain(field);
  });

  it('rejects an unknown filter', async () => {
    const errors = await errorsOf(query({ budget: '100' }));
    expect(errors).toContain('property budget should not exist');
  });
});

describe('ProjectResponseDto', () => {
  const entity: ProjectWithOwner = {
    id: 'a3f1c2d4-0000-4000-8000-000000000001',
    code: 'CRM-2026',
    name: 'CRM Migration',
    description: null,
    status: 'ACTIVE',
    priority: 'HIGH',
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    dueDate: null,
    completedAt: null,
    budget: new Prisma.Decimal('10.50'),
    currency: 'EUR',
    ownerId: '150944a0-7cf6-4deb-93d1-81903cd79391',
    version: 3,
    createdById: '150944a0-7cf6-4deb-93d1-81903cd79391',
    updatedById: '150944a0-7cf6-4deb-93d1-81903cd79391',
    deletedById: null,
    createdAt: new Date('2026-09-01T08:00:00.000Z'),
    updatedAt: new Date('2026-09-02T08:00:00.000Z'),
    deletedAt: null,
    owner: {
      id: '150944a0-7cf6-4deb-93d1-81903cd79391',
      firstName: 'Admin',
      lastName: 'User',
    },
  };

  it('formats dates as YYYY-MM-DD and budget with two decimals', () => {
    const dto = ProjectResponseDto.fromEntity(entity);
    expect(dto.startDate).toBe('2026-09-01');
    expect(dto.dueDate).toBeNull();
    expect(dto.budget).toBe('10.50');
    expect(dto.owner).toEqual(entity.owner);
    expect(dto.version).toBe(3);
  });

  it('exposes only the allowlisted fields', () => {
    const dto = ProjectResponseDto.fromEntity({
      ...entity,
      owner: { ...entity.owner, passwordHash: 'secret' } as never,
    });
    expect(Object.keys(dto).sort()).toEqual(
      [
        'id',
        'code',
        'name',
        'description',
        'status',
        'priority',
        'startDate',
        'dueDate',
        'completedAt',
        'budget',
        'currency',
        'owner',
        'version',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(Object.keys(dto.owner).sort()).toEqual([
      'firstName',
      'id',
      'lastName',
    ]);
  });
});
