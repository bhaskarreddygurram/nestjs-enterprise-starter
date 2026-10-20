import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { User } from '@prisma/client';
import { UserQueryDto } from './dto/user-query.dto';
import { AuditEmitter } from '../audit/audit.emitter';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('$argon2id$mocked-hash'),
}));

const mockUser: User = {
  id: 'b3f9c2e4-1a2b-4c5d-8e9f-0a1b2c3d4e5f',
  email: 'jane.doe@example.com',
  passwordHash: '$argon2id$existing-hash',
  firstName: 'Jane',
  lastName: 'Doe',
  isActive: true,
  twoFactorEnabled: false,
  twoFactorSecret: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
};

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<UsersRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByEmail: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        { provide: AuditEmitter, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(UsersService);
    repository = module.get(UsersRepository);
  });

  describe('create', () => {
    it('hashes the password and never stores the plaintext', async () => {
      repository.findByEmail.mockResolvedValue(null);
      repository.create.mockResolvedValue(mockUser);

      await service.create({
        email: 'jane.doe@example.com',
        password: 'Str0ng!Passw0rd',
      });

      const createArg = repository.create.mock.calls[0][0];
      expect(createArg.passwordHash).toBe('$argon2id$mocked-hash');
      expect(JSON.stringify(createArg)).not.toContain('Str0ng!Passw0rd');
    });

    it('returns a response DTO without the password hash', async () => {
      repository.findByEmail.mockResolvedValue(null);
      repository.create.mockResolvedValue(mockUser);

      const result = await service.create({
        email: 'jane.doe@example.com',
        password: 'Str0ng!Passw0rd',
      });

      expect(result.email).toBe(mockUser.email);
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws 409 when the email is already taken', async () => {
      repository.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.create({ email: mockUser.email, password: 'Str0ng!Passw0rd' }),
      ).rejects.toThrow(ConflictException);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns paginated data with correct meta', async () => {
      repository.findMany.mockResolvedValue([mockUser]);
      repository.count.mockResolvedValue(41);

      const query = Object.assign(new UserQueryDto(), { page: 2, limit: 20 });
      const result = await service.findAll(query);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({
        page: 2,
        limit: 20,
        totalItems: 41,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
    });

    it('builds a case-insensitive search filter', async () => {
      repository.findMany.mockResolvedValue([]);
      repository.count.mockResolvedValue(0);

      const query = Object.assign(new UserQueryDto(), { search: 'jane' });
      await service.findAll(query);

      const where = repository.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { email: { contains: 'jane', mode: 'insensitive' } },
        ]),
      );
    });

    it('rejects sort fields outside the whitelist', async () => {
      const query = Object.assign(new UserQueryDto(), { sort: 'passwordHash' });
      await expect(service.findAll(query)).rejects.toThrow(
        'Cannot sort by "passwordHash"',
      );
    });
  });

  describe('findOne', () => {
    it('returns the user when found', async () => {
      repository.findById.mockResolvedValue(mockUser);
      const result = await service.findOne(mockUser.id);
      expect(result.id).toBe(mockUser.id);
    });

    it('throws 404 when not found', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('exists', () => {
    it('is true for a live user and false otherwise', async () => {
      repository.findById.mockResolvedValueOnce(mockUser);
      await expect(service.exists(mockUser.id)).resolves.toBe(true);

      repository.findById.mockResolvedValueOnce(null);
      await expect(service.exists('missing-id')).resolves.toBe(false);
    });
  });

  describe('update', () => {
    it('throws 404 when the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.update('missing-id', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 409 when changing to an email that is taken', async () => {
      repository.findById.mockResolvedValue(mockUser);
      repository.findByEmail.mockResolvedValue({
        ...mockUser,
        id: 'another-user-id',
      });

      await expect(
        service.update(mockUser.id, { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('updates profile fields', async () => {
      repository.findById.mockResolvedValue(mockUser);
      repository.update.mockResolvedValue({ ...mockUser, firstName: 'Janet' });

      const result = await service.update(mockUser.id, { firstName: 'Janet' });
      expect(result.firstName).toBe('Janet');
    });
  });

  describe('remove', () => {
    it('soft-deletes an existing user', async () => {
      repository.findById.mockResolvedValue(mockUser);
      repository.softDelete.mockResolvedValue({
        ...mockUser,
        deletedAt: new Date(),
      });

      await service.remove(mockUser.id);
      expect(repository.softDelete).toHaveBeenCalledWith(mockUser.id);
    });

    it('throws 404 when the user does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
