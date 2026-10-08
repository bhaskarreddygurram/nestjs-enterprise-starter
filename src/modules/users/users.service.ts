import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PageMetaDto, PaginatedDto } from '../../common/dto/page-meta.dto';
import { parseSort } from '../../common/utils/sort.util';
import { AuditEmitter } from '../audit/audit.emitter';
import { AuditAction } from '../../shared/events/audit.event';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto, USER_SORTABLE_FIELDS } from './dto/user-query.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly audit: AuditEmitter,
  ) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(`Email "${dto.email}" is already in use`);
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.usersRepository.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      isActive: dto.isActive ?? true,
    });

    this.audit.emit({
      action: AuditAction.USER_CREATED,
      resource: 'user',
      resourceId: user.id,
      metadata: { email: user.email },
    });
    return UserResponseDto.fromEntity(user);
  }

  async findAll(query: UserQueryDto): Promise<PaginatedDto<UserResponseDto>> {
    const where: Prisma.UserWhereInput = {};

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy = parseSort(query.sort, USER_SORTABLE_FIELDS);

    const [users, totalItems] = await Promise.all([
      this.usersRepository.findMany({
        skip: query.skip,
        take: query.limit,
        where,
        orderBy,
      }),
      this.usersRepository.count(where),
    ]);

    return new PaginatedDto(
      users.map((user) => UserResponseDto.fromEntity(user)),
      new PageMetaDto(query.page, query.limit, totalItems),
    );
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    return UserResponseDto.fromEntity(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    if (dto.email && dto.email !== user.email) {
      const emailTaken = await this.usersRepository.findByEmail(dto.email);
      if (emailTaken) {
        throw new ConflictException(`Email "${dto.email}" is already in use`);
      }
    }

    const updated = await this.usersRepository.update(id, dto);
    this.audit.emit({
      action: AuditAction.USER_UPDATED,
      resource: 'user',
      resourceId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return UserResponseDto.fromEntity(updated);
  }

  async remove(id: string): Promise<void> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    await this.usersRepository.softDelete(id);
    this.audit.emit({
      action: AuditAction.USER_DELETED,
      resource: 'user',
      resourceId: id,
    });
  }

  /** Whether a live (not soft-deleted) user with this id exists. */
  async exists(id: string): Promise<boolean> {
    return (await this.usersRepository.findById(id)) !== null;
  }

  // --- Internal, for the Auth module only --------------------------------
  // These return the raw entity (including passwordHash) and must never be
  // surfaced through an HTTP response. Auth uses them to verify credentials
  // and resolve the JWT subject.

  findEntityByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  findEntityById(id: string): Promise<User | null> {
    return this.usersRepository.findById(id);
  }

  // --- Security depth (Phase 10), Auth module only -----------------------

  /** Atomically increment the failed-login counter; returns the new count. */
  async registerFailedLogin(id: string): Promise<number> {
    const updated = await this.usersRepository.update(id, {
      failedLoginAttempts: { increment: 1 },
    });
    return updated.failedLoginAttempts;
  }

  /** Lock the account until the given instant. */
  lockAccount(id: string, until: Date): Promise<User> {
    return this.usersRepository.update(id, { lockedUntil: until });
  }

  /** Clear the lockout state after a successful login. */
  clearLoginFailures(id: string): Promise<User> {
    return this.usersRepository.update(id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }

  /** Hash + store a new password and clear any lockout. */
  async setPassword(id: string, plainPassword: string): Promise<void> {
    const passwordHash = await argon2.hash(plainPassword);
    await this.usersRepository.update(id, {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }

  /** Store (or clear) the pending/active TOTP secret. */
  setTwoFactorSecret(id: string, secret: string | null): Promise<User> {
    return this.usersRepository.update(id, { twoFactorSecret: secret });
  }

  /** Flip the 2FA flag; disabling also clears the stored secret. */
  setTwoFactorEnabled(id: string, enabled: boolean): Promise<User> {
    return this.usersRepository.update(id, {
      twoFactorEnabled: enabled,
      ...(enabled ? {} : { twoFactorSecret: null }),
    });
  }
}
