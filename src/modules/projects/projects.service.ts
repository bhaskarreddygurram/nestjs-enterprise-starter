import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { PageMetaDto, PaginatedDto } from '../../common/dto/page-meta.dto';
import { PageRequest } from '../../common/types/page.types';
import { parseDateOnly } from '../../common/utils/date.util';
import { parseSort } from '../../common/utils/sort.util';
import { AuditAction } from '../../shared/events/audit.event';
import { AuditEmitter } from '../audit/audit.emitter';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { UsersService } from '../users/users.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsRepository } from './projects.repository';
import {
  PROJECT_SORTABLE_FIELDS,
  ProjectChanges,
  ProjectFilter,
  ProjectSortField,
} from './projects.types';

/** Listing soft-deleted projects is part of the restore workflow. */
const RESTORE_PERMISSION = 'project:restore';

/** The fields the cross-field rules look at, after a create or a merge. */
interface ProjectState {
  startDate: Date | null;
  dueDate: Date | null;
  hasBudget: boolean;
  hasCurrency: boolean;
}

/** `undefined` = not sent (leave alone); `null` = clear; string = new date. */
const toDate = (value: string | null | undefined): Date | null | undefined =>
  typeof value === 'string' ? parseDateOnly(value) : value;

/**
 * Business rules for projects. Speaks in DTOs and domain types only — every
 * query is the repository's job, so nothing here imports Prisma query syntax.
 *
 * Uniqueness of `code` is deliberately NOT pre-checked: the unique constraint
 * is the guard, and the global filter turns its violation into a 409.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly usersService: UsersService,
    private readonly audit: AuditEmitter,
  ) {}

  async create(
    dto: CreateProjectDto,
    actor: AuthenticatedUser,
  ): Promise<ProjectResponseDto> {
    const startDate = toDate(dto.startDate) ?? null;
    const dueDate = toDate(dto.dueDate) ?? null;
    this.assertConsistent({
      startDate,
      dueDate,
      hasBudget: dto.budget != null,
      hasCurrency: dto.currency != null,
    });

    const ownerId = dto.ownerId ?? actor.id;
    if (ownerId !== actor.id) {
      await this.assertOwnerExists(ownerId);
    }

    const project = await this.projectsRepository.create({
      code: dto.code,
      name: dto.name,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      startDate,
      dueDate,
      completedAt: dto.status === ProjectStatus.COMPLETED ? new Date() : null,
      budget: dto.budget,
      currency: dto.currency,
      ownerId,
      createdById: actor.id,
    });

    this.audit.emit({
      action: AuditAction.PROJECT_CREATED,
      resource: 'project',
      resourceId: project.id,
      metadata: { code: project.code },
    });
    return ProjectResponseDto.fromEntity(project);
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    actor: AuthenticatedUser,
  ): Promise<ProjectResponseDto> {
    const current = await this.projectsRepository.findById(id);
    if (!current) {
      throw new NotFoundException(`Project with id "${id}" not found`);
    }
    if (current.version !== dto.version) {
      throw this.staleVersion(current.version);
    }

    const { version, ...fields } = dto;
    const startDate = toDate(fields.startDate);
    const dueDate = toDate(fields.dueDate);

    // A PATCH is partial, so the rules are checked against what the row will
    // look like afterwards: stored values overlaid with the fields sent.
    this.assertConsistent({
      startDate: startDate === undefined ? current.startDate : startDate,
      dueDate: dueDate === undefined ? current.dueDate : dueDate,
      hasBudget:
        fields.budget === undefined
          ? current.budget !== null
          : fields.budget !== null,
      hasCurrency:
        fields.currency === undefined
          ? current.currency !== null
          : fields.currency !== null,
    });

    if (fields.ownerId !== undefined && fields.ownerId !== current.ownerId) {
      await this.assertOwnerExists(fields.ownerId);
    }

    const changes: ProjectChanges = {
      ...fields,
      startDate,
      dueDate,
      updatedById: actor.id,
    };
    if (fields.status !== undefined && fields.status !== current.status) {
      if (fields.status === ProjectStatus.COMPLETED) {
        changes.completedAt = new Date();
      } else if (current.status === ProjectStatus.COMPLETED) {
        changes.completedAt = null;
      }
    }

    const updated = await this.projectsRepository.update(id, version, changes);
    if (!updated) {
      // Lost a race since the read above: the row was deleted or changed.
      const latest = await this.projectsRepository.findById(id);
      if (!latest) {
        throw new NotFoundException(`Project with id "${id}" not found`);
      }
      throw this.staleVersion(latest.version);
    }

    this.audit.emit({
      action: AuditAction.PROJECT_UPDATED,
      resource: 'project',
      resourceId: id,
      metadata: { fields: Object.keys(fields) },
    });
    return ProjectResponseDto.fromEntity(updated);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const deleted = await this.projectsRepository.softDelete(id, actor.id);
    if (!deleted) {
      throw new NotFoundException(`Project with id "${id}" not found`);
    }
    this.audit.emit({
      action: AuditAction.PROJECT_DELETED,
      resource: 'project',
      resourceId: id,
      metadata: { code: deleted.code },
    });
  }

  async restore(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ProjectResponseDto> {
    const restored = await this.projectsRepository.restore(id, actor.id);
    if (!restored) {
      throw new NotFoundException(`No deleted project with id "${id}" found`);
    }
    this.audit.emit({
      action: AuditAction.PROJECT_RESTORED,
      resource: 'project',
      resourceId: id,
      metadata: { code: restored.code },
    });
    return ProjectResponseDto.fromEntity(restored);
  }

  async findAll(
    query: ProjectQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedDto<ProjectResponseDto>> {
    if (
      query.deleted === 'only' &&
      !actor.permissions.includes(RESTORE_PERMISSION)
    ) {
      throw new ForbiddenException(
        `Listing deleted projects requires permission: ${RESTORE_PERMISSION}`,
      );
    }

    const { items, total } = await this.projectsRepository.findPage(
      this.toFilter(query),
      this.toPageRequest(query),
    );

    return new PaginatedDto(
      items.map((project) => ProjectResponseDto.fromEntity(project)),
      new PageMetaDto(query.page, query.limit, total),
    );
  }

  async findOne(id: string): Promise<ProjectResponseDto> {
    const project = await this.projectsRepository.findById(id);
    if (!project) {
      throw new NotFoundException(`Project with id "${id}" not found`);
    }
    return ProjectResponseDto.fromEntity(project);
  }

  /** Cross-field rules. The date rule is also a CHECK constraint in the DB. */
  private assertConsistent(state: ProjectState): void {
    if (state.startDate && state.dueDate && state.dueDate < state.startDate) {
      throw new BadRequestException('dueDate must not be before startDate');
    }
    if (state.hasBudget !== state.hasCurrency) {
      throw new BadRequestException(
        'budget and currency must be provided together',
      );
    }
  }

  private async assertOwnerExists(ownerId: string): Promise<void> {
    if (!(await this.usersService.exists(ownerId))) {
      throw new BadRequestException(`Owner with id "${ownerId}" not found`);
    }
  }

  private staleVersion(currentVersion: number): ConflictException {
    return new ConflictException(
      `Project was changed by someone else (current version ${currentVersion}). Reload it and try again.`,
    );
  }

  /** Query DTO (strings, as sent over HTTP) → domain filter (typed values). */
  private toFilter(query: ProjectQueryDto): ProjectFilter {
    const dueFrom = query.dueFrom ? parseDateOnly(query.dueFrom) : undefined;
    const dueTo = query.dueTo ? parseDateOnly(query.dueTo) : undefined;
    if (dueFrom && dueTo && dueFrom > dueTo) {
      throw new BadRequestException('dueFrom must not be after dueTo');
    }

    return {
      search: query.search || undefined,
      statuses: query.status,
      priorities: query.priority,
      ownerId: query.ownerId,
      dueFrom,
      dueTo,
      deleted: query.deleted,
    };
  }

  private toPageRequest(query: ProjectQueryDto): PageRequest<ProjectSortField> {
    return {
      skip: query.skip,
      take: query.limit,
      // parseSort rejects anything outside the whitelist, so the keys are
      // guaranteed to be ProjectSortField
      sort: parseSort(query.sort, PROJECT_SORTABLE_FIELDS),
    };
  }
}
