import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AuditEmitter } from '../audit/audit.emitter';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { UsersService } from '../users/users.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';
import { ProjectWithOwner } from './projects.types';

const ADMIN_ID = '150944a0-7cf6-4deb-93d1-81903cd79391';
const OTHER_USER_ID = '9d2b7c11-3f4e-4a5b-8c6d-7e8f9a0b1c2d';
const NOW = new Date('2026-10-08T12:00:00.000Z');

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
  let users: jest.Mocked<Pick<UsersService, 'exists'>>;
  let audit: jest.Mocked<Pick<AuditEmitter, 'emit'>>;

  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

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
        { provide: UsersService, useValue: { exists: jest.fn() } },
        { provide: AuditEmitter, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProjectsService);
    repository = module.get(ProjectsRepository);
    users = module.get(UsersService);
    audit = module.get(AuditEmitter);
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

  describe('create', () => {
    const admin = actorWith('project:create');
    const minimal: CreateProjectDto = { code: 'NEW-1', name: 'New project' };

    beforeEach(() => {
      repository.create.mockResolvedValue(mockProject);
    });

    it('defaults the owner to the caller and stamps createdById', async () => {
      await service.create(minimal, admin);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'NEW-1',
          name: 'New project',
          ownerId: ADMIN_ID,
          createdById: ADMIN_ID,
          startDate: null,
          dueDate: null,
          completedAt: null,
        }),
      );
      // the caller is authenticated, so there is nothing to look up
      expect(users.exists).not.toHaveBeenCalled();
    });

    it('converts date strings and passes the rest through', async () => {
      await service.create(
        {
          ...minimal,
          description: 'text',
          status: 'ACTIVE',
          priority: 'HIGH',
          startDate: '2026-09-01',
          dueDate: '2026-12-15',
          budget: '48000.00',
          currency: 'EUR',
        },
        admin,
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'text',
          status: 'ACTIVE',
          priority: 'HIGH',
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          dueDate: new Date('2026-12-15T00:00:00.000Z'),
          budget: '48000.00',
          currency: 'EUR',
        }),
      );
    });

    it('accepts another existing user as owner', async () => {
      users.exists.mockResolvedValue(true);

      await service.create({ ...minimal, ownerId: OTHER_USER_ID }, admin);

      expect(users.exists).toHaveBeenCalledWith(OTHER_USER_ID);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: OTHER_USER_ID,
          createdById: ADMIN_ID,
        }),
      );
    });

    it('rejects an owner that does not exist', async () => {
      users.exists.mockResolvedValue(false);

      await expect(
        service.create({ ...minimal, ownerId: OTHER_USER_ID }, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects a due date before the start date', async () => {
      await expect(
        service.create(
          { ...minimal, startDate: '2026-12-15', dueDate: '2026-12-14' },
          admin,
        ),
      ).rejects.toThrow('dueDate must not be before startDate');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('accepts a due date equal to the start date', async () => {
      await expect(
        service.create(
          { ...minimal, startDate: '2026-12-15', dueDate: '2026-12-15' },
          admin,
        ),
      ).resolves.toBeDefined();
    });

    it.each([
      ['budget without currency', { budget: '100.00' }],
      ['currency without budget', { currency: 'EUR' }],
      ['budget with null currency', { budget: '100.00', currency: null }],
    ])('rejects %s', async (_label, extra) => {
      await expect(
        service.create({ ...minimal, ...extra }, admin),
      ).rejects.toThrow('budget and currency must be provided together');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('stamps completedAt when created as COMPLETED', async () => {
      await service.create({ ...minimal, status: 'COMPLETED' }, admin);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ completedAt: NOW }),
      );
    });

    it('lets a duplicate-code error from the database propagate', async () => {
      const duplicate = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['code'] },
      });
      repository.create.mockRejectedValue(duplicate);

      await expect(service.create(minimal, admin)).rejects.toBe(duplicate);
      expect(audit.emit).not.toHaveBeenCalled();
    });

    it('emits project.created and returns the response DTO', async () => {
      const result = await service.create(minimal, admin);

      expect(audit.emit).toHaveBeenCalledWith({
        action: 'project.created',
        resource: 'project',
        resourceId: mockProject.id,
        metadata: { code: 'CRM-2026' },
      });
      expect(result).toMatchObject({ id: mockProject.id, version: 1 });
    });
  });

  describe('update', () => {
    const admin = actorWith('project:update');
    const id = mockProject.id;
    const patch = (
      fields: Partial<UpdateProjectDto> = {},
    ): UpdateProjectDto => ({ version: 1, ...fields });

    beforeEach(() => {
      repository.findById.mockResolvedValue(mockProject);
      repository.update.mockResolvedValue({ ...mockProject, version: 2 });
    });

    it('sends only the changed fields, the expected version and the actor', async () => {
      await service.update(id, patch({ name: 'Renamed' }), admin);

      expect(repository.update).toHaveBeenCalledWith(id, 1, {
        name: 'Renamed',
        updatedById: ADMIN_ID,
      });
    });

    it('returns 404 for a missing or deleted project', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(id, patch({ name: 'x' }), admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('returns 409 when the client version is stale', async () => {
      repository.findById.mockResolvedValue({ ...mockProject, version: 4 });

      await expect(
        service.update(id, patch({ name: 'x' }), admin),
      ).rejects.toThrow(/current version 4/);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('returns 409 when another writer wins the race after the read', async () => {
      repository.update.mockResolvedValue(null);
      repository.findById
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({ ...mockProject, version: 2 });

      await expect(
        service.update(id, patch({ name: 'x' }), admin),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(audit.emit).not.toHaveBeenCalled();
    });

    it('returns 404 when the project is deleted after the read', async () => {
      repository.update.mockResolvedValue(null);
      repository.findById
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(null);

      await expect(
        service.update(id, patch({ name: 'x' }), admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('date rule on the merged state', () => {
      // stored: start 2026-09-01, due 2026-12-15
      it('rejects a new dueDate before the stored startDate', async () => {
        await expect(
          service.update(id, patch({ dueDate: '2026-08-31' }), admin),
        ).rejects.toThrow('dueDate must not be before startDate');
        expect(repository.update).not.toHaveBeenCalled();
      });

      it('rejects a new startDate after the stored dueDate', async () => {
        await expect(
          service.update(id, patch({ startDate: '2026-12-16' }), admin),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('accepts moving both dates together', async () => {
        await service.update(
          id,
          patch({ startDate: '2027-01-01', dueDate: '2027-02-01' }),
          admin,
        );

        expect(repository.update).toHaveBeenCalledWith(
          id,
          1,
          expect.objectContaining({
            startDate: new Date('2027-01-01T00:00:00.000Z'),
            dueDate: new Date('2027-02-01T00:00:00.000Z'),
          }),
        );
      });

      it('accepts a late startDate when dueDate is cleared in the same request', async () => {
        await service.update(
          id,
          patch({ startDate: '2027-06-01', dueDate: null }),
          admin,
        );

        expect(repository.update).toHaveBeenCalledWith(
          id,
          1,
          expect.objectContaining({ dueDate: null }),
        );
      });
    });

    describe('budget + currency rule on the merged state', () => {
      // stored: budget 48000.00 EUR
      it('accepts changing only the budget', async () => {
        await expect(
          service.update(id, patch({ budget: '50000.00' }), admin),
        ).resolves.toBeDefined();
      });

      it('rejects clearing only the budget', async () => {
        await expect(
          service.update(id, patch({ budget: null }), admin),
        ).rejects.toThrow('budget and currency must be provided together');
      });

      it('rejects clearing only the currency', async () => {
        await expect(
          service.update(id, patch({ currency: null }), admin),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('accepts clearing both', async () => {
        await service.update(
          id,
          patch({ budget: null, currency: null }),
          admin,
        );

        expect(repository.update).toHaveBeenCalledWith(
          id,
          1,
          expect.objectContaining({ budget: null, currency: null }),
        );
      });

      it('rejects adding only a budget to a project that has none', async () => {
        repository.findById.mockResolvedValue({
          ...mockProject,
          budget: null,
          currency: null,
        });

        await expect(
          service.update(id, patch({ budget: '10.00' }), admin),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('owner', () => {
      it('checks a new owner exists', async () => {
        users.exists.mockResolvedValue(true);

        await service.update(id, patch({ ownerId: OTHER_USER_ID }), admin);

        expect(users.exists).toHaveBeenCalledWith(OTHER_USER_ID);
        expect(repository.update).toHaveBeenCalledWith(
          id,
          1,
          expect.objectContaining({ ownerId: OTHER_USER_ID }),
        );
      });

      it('rejects an owner that does not exist', async () => {
        users.exists.mockResolvedValue(false);

        await expect(
          service.update(id, patch({ ownerId: OTHER_USER_ID }), admin),
        ).rejects.toThrow(/Owner with id/);
        expect(repository.update).not.toHaveBeenCalled();
      });

      it('skips the lookup when the owner is unchanged', async () => {
        await service.update(id, patch({ ownerId: ADMIN_ID }), admin);

        expect(users.exists).not.toHaveBeenCalled();
      });
    });

    describe('completedAt follows status', () => {
      it('is stamped when the project becomes COMPLETED', async () => {
        await service.update(id, patch({ status: 'COMPLETED' }), admin);

        expect(repository.update).toHaveBeenCalledWith(
          id,
          1,
          expect.objectContaining({ status: 'COMPLETED', completedAt: NOW }),
        );
      });

      it('is cleared when the project leaves COMPLETED', async () => {
        repository.findById.mockResolvedValue({
          ...mockProject,
          status: 'COMPLETED',
          completedAt: new Date('2026-06-24T15:30:00.000Z'),
        });

        await service.update(id, patch({ status: 'ACTIVE' }), admin);

        expect(repository.update).toHaveBeenCalledWith(
          id,
          1,
          expect.objectContaining({ status: 'ACTIVE', completedAt: null }),
        );
      });

      it('is left alone when a COMPLETED project is saved as COMPLETED again', async () => {
        repository.findById.mockResolvedValue({
          ...mockProject,
          status: 'COMPLETED',
          completedAt: new Date('2026-06-24T15:30:00.000Z'),
        });

        await service.update(
          id,
          patch({ status: 'COMPLETED', name: 'x' }),
          admin,
        );

        const [, , changes] = repository.update.mock.calls[0];
        expect(changes).not.toHaveProperty('completedAt');
      });

      it('is left alone when moving between two open statuses', async () => {
        await service.update(id, patch({ status: 'ON_HOLD' }), admin);

        const [, , changes] = repository.update.mock.calls[0];
        expect(changes).not.toHaveProperty('completedAt');
      });
    });

    it('emits project.updated naming the fields sent, not the version', async () => {
      const result = await service.update(
        id,
        patch({ name: 'Renamed', priority: 'LOW' }),
        admin,
      );

      expect(audit.emit).toHaveBeenCalledWith({
        action: 'project.updated',
        resource: 'project',
        resourceId: id,
        metadata: { fields: ['name', 'priority'] },
      });
      expect(result.version).toBe(2);
    });
  });

  describe('remove', () => {
    const admin = actorWith('project:delete');

    it('soft-deletes as the caller and emits project.deleted', async () => {
      repository.softDelete.mockResolvedValue(mockProject);

      await expect(
        service.remove(mockProject.id, admin),
      ).resolves.toBeUndefined();

      expect(repository.softDelete).toHaveBeenCalledWith(
        mockProject.id,
        ADMIN_ID,
      );
      expect(audit.emit).toHaveBeenCalledWith({
        action: 'project.deleted',
        resource: 'project',
        resourceId: mockProject.id,
        metadata: { code: 'CRM-2026' },
      });
    });

    it('returns 404 when the project is missing or already deleted', async () => {
      repository.softDelete.mockResolvedValue(null);

      await expect(
        service.remove(mockProject.id, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.emit).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    const admin = actorWith('project:restore');

    it('restores as the caller and emits project.restored', async () => {
      repository.restore.mockResolvedValue({ ...mockProject, version: 3 });

      const result = await service.restore(mockProject.id, admin);

      expect(repository.restore).toHaveBeenCalledWith(mockProject.id, ADMIN_ID);
      expect(audit.emit).toHaveBeenCalledWith({
        action: 'project.restored',
        resource: 'project',
        resourceId: mockProject.id,
        metadata: { code: 'CRM-2026' },
      });
      expect(result.version).toBe(3);
    });

    it('returns 404 when there is no deleted project with that id', async () => {
      repository.restore.mockResolvedValue(null);

      await expect(
        service.restore(mockProject.id, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.emit).not.toHaveBeenCalled();
    });
  });
});
