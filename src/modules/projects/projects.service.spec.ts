import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { ProjectQueryDto } from './dto/project-query.dto';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';
import { ProjectWithOwner } from './projects.types';

const ADMIN_ID = '150944a0-7cf6-4deb-93d1-81903cd79391';

const mockProject: ProjectWithOwner = {
  id: 'a3f1c2d4-0000-4000-8000-000000000001',
  code: 'CRM-2026',
  name: 'CRM Migration',
  description: 'Move customer records.',
  status: 'ACTIVE',
  priority: 'HIGH',
  startDate: new Date('2026-09-01T00:00:00.000Z'),
  dueDate: new Date('2026-12-15T00:00:00.000Z'),
  completedAt: null,
  budget: new Prisma.Decimal('48000.00'),
  currency: 'EUR',
  ownerId: ADMIN_ID,
  version: 1,
  createdById: ADMIN_ID,
  updatedById: null,
  deletedById: null,
  createdAt: new Date('2026-09-01T08:00:00.000Z'),
  updatedAt: new Date('2026-09-01T08:00:00.000Z'),
  deletedAt: null,
  owner: { id: ADMIN_ID, firstName: 'Admin', lastName: 'User' },
};

const actorWith = (...permissions: string[]): AuthenticatedUser => ({
  id: ADMIN_ID,
  email: 'admin@example.com',
  isActive: true,
  roles: [],
  permissions,
});

const reader = actorWith('project:read');

/** A query DTO as the ValidationPipe would hand it over (defaults applied). */
const queryOf = (overrides: Partial<ProjectQueryDto> = {}): ProjectQueryDto =>
  Object.assign(new ProjectQueryDto(), overrides);

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repository: jest.Mocked<ProjectsRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: ProjectsRepository,
          useValue: {
            findPage: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
            restore: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ProjectsService);
    repository = module.get(ProjectsRepository);
  });

  describe('findAll', () => {
    beforeEach(() => {
      repository.findPage.mockResolvedValue({ items: [mockProject], total: 1 });
    });

    it('asks for live rows, first page, newest first by default', async () => {
      await service.findAll(queryOf(), reader);

      expect(repository.findPage).toHaveBeenCalledWith(
        {
          search: undefined,
          statuses: undefined,
          priorities: undefined,
          ownerId: undefined,
          dueFrom: undefined,
          dueTo: undefined,
          deleted: 'exclude',
        },
        { skip: 0, take: 20, sort: [{ createdAt: 'desc' }] },
      );
    });

    it('maps every query field to the domain filter', async () => {
      await service.findAll(
        queryOf({
          search: 'crm',
          status: ['ACTIVE', 'ON_HOLD'],
          priority: ['HIGH'],
          ownerId: ADMIN_ID,
          dueFrom: '2026-12-01',
          dueTo: '2027-03-01',
        }),
        reader,
      );

      expect(repository.findPage).toHaveBeenCalledWith(
        {
          search: 'crm',
          statuses: ['ACTIVE', 'ON_HOLD'],
          priorities: ['HIGH'],
          ownerId: ADMIN_ID,
          dueFrom: new Date('2026-12-01T00:00:00.000Z'),
          dueTo: new Date('2027-03-01T00:00:00.000Z'),
          deleted: 'exclude',
        },
        expect.anything(),
      );
    });

    it('treats an empty search string as no search', async () => {
      await service.findAll(queryOf({ search: '' }), reader);

      const [filter] = repository.findPage.mock.calls[0];
      expect(filter.search).toBeUndefined();
    });

    it('turns page / limit / sort into a page request', async () => {
      await service.findAll(
        queryOf({ page: 3, limit: 10, sort: '-dueDate,name' }),
        reader,
      );

      expect(repository.findPage).toHaveBeenCalledWith(expect.anything(), {
        skip: 20,
        take: 10,
        sort: [{ dueDate: 'desc' }, { name: 'asc' }],
      });
    });

    it('rejects a sort field outside the whitelist without querying', async () => {
      await expect(
        service.findAll(queryOf({ sort: 'budget' }), reader),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.findPage).not.toHaveBeenCalled();
    });

    it('rejects a due range that ends before it starts', async () => {
      await expect(
        service.findAll(
          queryOf({ dueFrom: '2026-12-31', dueTo: '2026-12-01' }),
          reader,
        ),
      ).rejects.toThrow('dueFrom must not be after dueTo');
      expect(repository.findPage).not.toHaveBeenCalled();
    });

    it('accepts a one-day due range', async () => {
      await expect(
        service.findAll(
          queryOf({ dueFrom: '2026-12-15', dueTo: '2026-12-15' }),
          reader,
        ),
      ).resolves.toBeDefined();
    });

    it('refuses deleted=only without project:restore', async () => {
      await expect(
        service.findAll(queryOf({ deleted: 'only' }), reader),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.findPage).not.toHaveBeenCalled();
    });

    it('allows deleted=only with project:restore', async () => {
      await service.findAll(
        queryOf({ deleted: 'only' }),
        actorWith('project:read', 'project:restore'),
      );

      const [filter] = repository.findPage.mock.calls[0];
      expect(filter.deleted).toBe('only');
    });

    it('returns response DTOs with pagination meta', async () => {
      repository.findPage.mockResolvedValue({
        items: [mockProject],
        total: 45,
      });

      const result = await service.findAll(
        queryOf({ page: 2, limit: 20 }),
        reader,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        code: 'CRM-2026',
        startDate: '2026-09-01',
        budget: '48000.00',
        owner: { id: ADMIN_ID, firstName: 'Admin', lastName: 'User' },
      });
      // internal columns never reach the response
      expect(result.data[0]).not.toHaveProperty('deletedAt');
      expect(result.data[0]).not.toHaveProperty('createdById');
      expect(result.meta).toMatchObject({
        page: 2,
        limit: 20,
        totalItems: 45,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });

    it('returns an empty page when nothing matches', async () => {
      repository.findPage.mockResolvedValue({ items: [], total: 0 });

      const result = await service.findAll(queryOf(), reader);

      expect(result.data).toEqual([]);
      expect(result.meta).toMatchObject({ totalItems: 0, hasNext: false });
    });
  });

  describe('findOne', () => {
    it('returns the project as a response DTO', async () => {
      repository.findById.mockResolvedValue(mockProject);

      const result = await service.findOne(mockProject.id);

      expect(repository.findById).toHaveBeenCalledWith(mockProject.id);
      expect(result).toMatchObject({ id: mockProject.id, code: 'CRM-2026' });
    });

    it('throws NotFoundException for a missing or deleted project', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findOne(mockProject.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
